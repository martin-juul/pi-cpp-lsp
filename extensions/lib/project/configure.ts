import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { boundedOutput } from "../output.ts";
import { buildLockPath, managedBuildDir, readProjectState } from "./root.ts";

/** Command executor with pi.exec's signature, so the session can pass pi.exec directly. */
export type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

export const CONFIGURE_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 30_000;
const LOCK_POLL_MS = 200;

/** The File API client name; the codemodel v2 and cmakeFiles v1 replies appear under this key. */
export const FILE_API_CLIENT = "client-pi-cpp-lsp";
const FILE_API_QUERIES = ["codemodel-v2", "cmakeFiles-v1"];

export interface CmakeVersion {
  major: number;
  minor: number;
  patch: number;
  text: string;
}

const atLeast = (v: CmakeVersion, major: number, minor: number) => v.major > major || (v.major === major && v.minor >= minor);
/** CMake 3.14 is the oldest version with the File API codemodel v2. */
export const isSupportedCmake = (v: CmakeVersion) => atLeast(v, 3, 14);
export const supportsPresets = (v: CmakeVersion) => atLeast(v, 3, 19);

/** Run `cmake --version`; undefined when cmake is missing or unparsable. */
export async function probeCmake(exec: Exec, signal?: AbortSignal): Promise<CmakeVersion | undefined> {
  try {
    const result = await exec("cmake", ["--version"], { signal, timeout: PROBE_TIMEOUT_MS });
    const match = result.code === 0 ? result.stdout.match(/cmake version (\d+)\.(\d+)\.(\d+)\S*/) : null;
    if (!match) return undefined;
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), text: match[0].slice("cmake version ".length) };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Presets

type RawPreset = Record<string, unknown> & { name: string };
export const PRESET_FILES = ["CMakePresets.json", "CMakeUserPresets.json"];

function loadPresetFile(path: string, root: string, presets: Map<string, RawPreset>, seen: Set<string>, errors: string[]): void {
  if (seen.has(path)) return;
  seen.add(path);
  let data: { include?: unknown; configurePresets?: unknown };
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const name = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
    errors.push(`Could not parse ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (Array.isArray(data.include)) {
    for (const include of data.include) {
      if (typeof include === "string") loadPresetFile(resolve(dirname(path), include), root, presets, seen, errors);
    }
  }
  if (Array.isArray(data.configurePresets)) {
    for (const preset of data.configurePresets) {
      if (preset && typeof preset.name === "string") presets.set(preset.name, preset);
    }
  }
}

// Follow `inherits` the way CMake does: the preset's own value first, then each parent in order.
function inheritedField(presets: Map<string, RawPreset>, name: string, pick: (preset: RawPreset) => string | undefined, seen = new Set<string>()): string | undefined {
  const preset = presets.get(name);
  if (!preset || seen.has(name)) return undefined;
  seen.add(name);
  const own = pick(preset);
  if (own !== undefined) return own;
  const parents = typeof preset.inherits === "string" ? [preset.inherits] : Array.isArray(preset.inherits) ? preset.inherits : [];
  for (const parent of parents) {
    const value = typeof parent === "string" ? inheritedField(presets, parent, pick, seen) : undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

const pickGenerator = (preset: RawPreset) => typeof preset.generator === "string" ? preset.generator : undefined;
function pickBuildType(preset: RawPreset): string | undefined {
  const variables = preset.cacheVariables as Record<string, unknown> | undefined;
  const value = variables?.CMAKE_BUILD_TYPE;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { value?: unknown }).value === "string") return (value as { value: string }).value;
  return undefined;
}

export interface PresetResolution {
  /** The preset to configure with, or undefined to configure without one. */
  preset?: string;
  /** The preset picked when nothing valid is remembered. */
  defaultPreset?: string;
  /** Configure presets visible on this host, in CMake's order. */
  available: string[];
  /** The chosen preset's generator and CMAKE_BUILD_TYPE, following `inherits`. */
  generator?: string;
  buildType?: string;
  /** Messages for the briefing: ignored or unparsable presets, a remembered preset that vanished. */
  notes: string[];
}

/** Rank presets: the first visible configure preset whose name mentions debug or dev, else the first visible one. */
export function rankDefaultPreset(available: string[]): string | undefined {
  return available.find(name => /debug|dev/i.test(name)) ?? available[0];
}

/**
 * Decide which configure preset applies (R3, AE7): the remembered choice when CMake still lists it,
 * otherwise the default. Preset files never fail resolution; problems become notes.
 */
export async function resolvePreset(root: string, exec: Exec, cmake: CmakeVersion, signal?: AbortSignal): Promise<PresetResolution> {
  const files = PRESET_FILES.filter(name => existsSync(join(root, name)));
  if (files.length === 0) return { available: [], notes: [] };
  if (!supportsPresets(cmake)) {
    return { available: [], notes: [`CMake ${cmake.text} is older than 3.19, and presets need CMake 3.19, so ${files.join(" and ")} ${files.length > 1 ? "are" : "is"} ignored.`] };
  }

  const presets = new Map<string, RawPreset>();
  const errors: string[] = [];
  const seen = new Set<string>();
  // User presets come last so they win on a name clash.
  for (const name of files) loadPresetFile(join(root, name), root, presets, seen, errors);
  if (errors.length > 0) return { available: [], notes: [...errors, "Configuring without a preset."] };

  const listed = await exec("cmake", ["--list-presets"], { cwd: root, signal, timeout: PROBE_TIMEOUT_MS });
  if (listed.code !== 0 || listed.killed) {
    const message = [listed.stderr, listed.stdout].join("\n").trim().split("\n").slice(0, 5).join("\n");
    return { available: [], notes: [`cmake --list-presets failed${message ? `: ${message}` : ""}`, "Configuring without a preset."] };
  }
  const available = [...listed.stdout.matchAll(/^\s+"(.+)"/gm)].map(match => match[1]);
  const defaultPreset = rankDefaultPreset(available);
  if (defaultPreset === undefined) return { available, notes: [] };

  const notes: string[] = [];
  const remembered = readProjectState(root).preset;
  let preset = defaultPreset;
  if (remembered !== undefined && available.includes(remembered)) preset = remembered;
  else if (remembered !== undefined) notes.push(`Remembered preset "${remembered}" no longer exists; using the default preset "${defaultPreset}".`);
  return {
    preset, defaultPreset, available, notes,
    generator: inheritedField(presets, preset, pickGenerator),
    buildType: inheritedField(presets, preset, pickBuildType),
  };
}

// ---------------------------------------------------------------------------
// Configure output and replies

export interface MissingSource {
  /** Absolute path of the source file CMake could not find. */
  path: string;
  /** Absolute path of the CMake file whose command lists it. */
  file: string;
  /** 1-based line of that command. */
  line: number;
}

/** Turn `CMake Error at <file>:<line>` blocks reporting `Cannot find source file` into missing findings (KTD22). */
export function parseMissingSources(output: string, root: string): MissingSource[] {
  const pattern = /CMake Error at (.+):(\d+) \([^)\n]*\):\r?\n[ \t]*Cannot find source file:\r?\n(?:[ \t]*\r?\n)*[ \t]*(\S.*?)[ \t]*\r?$/gm;
  const found = new Map<string, MissingSource>();
  for (const match of output.matchAll(pattern)) {
    const file = isAbsolute(match[1]) ? match[1] : resolve(root, match[1]);
    const missing: MissingSource = { path: resolve(dirname(file), match[3]), file, line: Number(match[2]) };
    found.set(`${missing.path}\0${missing.file}\0${missing.line}`, missing);
  }
  return [...found.values()];
}

export interface ReplyState {
  /** Newest reply index: `index-*.json` from a successful configure or `error-*.json` from a failed one. */
  newest?: string;
  newestIsError: boolean;
  /** Whether `newest` was written at or after the run's start. */
  newestFromThisRun: boolean;
  /** Newest successful `index-*.json`; CMake keeps it when a later configure fails. */
  lastGood?: string;
}

const replyStamp = (name: string) => name.slice(name.indexOf("-") + 1);

/** Inspect the File API reply directory of a build directory. */
export function readReplyState(buildDir: string, since?: number): ReplyState {
  const dir = join(buildDir, ".cmake", "api", "v1", "reply");
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return { newestIsError: false, newestFromThisRun: false };
  }
  const newestOf = (prefix: string) => names.filter(name => name.startsWith(prefix) && name.endsWith(".json"))
    .sort((a, b) => replyStamp(a).localeCompare(replyStamp(b))).at(-1);
  const index = newestOf("index-");
  const error = newestOf("error-");
  const newestName = index && error ? (replyStamp(error) > replyStamp(index) ? error : index) : index ?? error;
  const newest = newestName ? join(dir, newestName) : undefined;
  let fromThisRun = false;
  if (newest && since !== undefined) {
    try {
      fromThisRun = statSync(newest).mtimeMs >= since;
    } catch { /* removed concurrently */ }
  }
  return {
    newest,
    newestIsError: newestName !== undefined && newestName === error,
    newestFromThisRun: fromThisRun,
    lastGood: index ? join(dir, index) : undefined,
  };
}

function writeFileApiQueries(buildDir: string): void {
  const dir = join(buildDir, ".cmake", "api", "v1", "query", FILE_API_CLIENT);
  mkdirSync(dir, { recursive: true });
  for (const query of FILE_API_QUERIES) writeFileSync(join(dir, query), "");
}

function readCacheVariables(buildDir: string): { generator?: string; buildType?: string } {
  let text: string;
  try {
    text = readFileSync(join(buildDir, "CMakeCache.txt"), "utf8");
  } catch {
    return {};
  }
  const value = (name: string) => text.match(new RegExp(`^${name}:[A-Z]+=(.*)$`, "m"))?.[1].trim() || undefined;
  return { generator: value("CMAKE_GENERATOR"), buildType: value("CMAKE_BUILD_TYPE") };
}

// The managed directory is single-config, so multi-config and Xcode preset generators are replaced.
const isMultiConfig = (generator: string) => /Multi-Config|^Visual Studio|^Xcode/.test(generator);

// ---------------------------------------------------------------------------
// Lock (KTD19)

interface LockInfo {
  pid: number;
  startedAt: number;
}

function tryLock(path: string): LockInfo | undefined {
  const info: LockInfo = { pid: process.pid, startedAt: Date.now() };
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(info));
  try {
    // A hard link is created exclusively and atomically, so the lock never exists without its content.
    linkSync(temp, path);
    return info;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
}

function readLock(path: string): LockInfo | "missing" | "corrupt" {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return "missing";
  }
  try {
    const data = JSON.parse(text);
    return Number.isInteger(data?.pid) && typeof data?.startedAt === "number" ? { pid: data.pid, startedAt: data.startedAt } : "corrupt";
  } catch {
    return "corrupt";
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sameLock = (a: LockInfo, b: LockInfo) => a.pid === b.pid && a.startedAt === b.startedAt;

function releaseLock(path: string, mine: LockInfo): void {
  const current = readLock(path);
  if (typeof current === "object" && sameLock(current, mine)) rmSync(path, { force: true });
}

// ---------------------------------------------------------------------------
// Configure manager

export type ConfigureStatus = "succeeded" | "failed" | "cancelled" | "timedOut";

export interface ConfigureResult {
  status: ConfigureStatus;
  sourceRoot: string;
  /** Managed build directory; undefined only when the run stopped before choosing one. */
  buildDir?: string;
  preset?: string;
  generator?: string;
  /** Arguments passed to cmake; empty when nothing ran. */
  args: string[];
  /** When the configure that produced these replies started (epoch ms). Inputs modified later are not reflected. */
  startedAt: number;
  finishedAt: number;
  exitCode: number | null;
  /** Bounded status line and CMake output. */
  output: string;
  truncated: boolean;
  logFile?: string;
  /** Sources listed in CMake files but missing on disk, parsed from a failed configure. */
  missingSources: MissingSource[];
  reply: ReplyState;
  notes: string[];
  /** True when another pi session held the lock and this result reuses its replies. */
  reusedFromOtherSession: boolean;
}

export interface ConfigureManagerOptions {
  /** CMake source root, as returned by findSourceRoot. */
  root: string;
  exec: Exec;
  /** Aborting kills a running configure and cancels the queued rerun (session shutdown). */
  signal?: AbortSignal;
  /** The version a caller already probed; without it the first run probes cmake. */
  cmake?: CmakeVersion;
}

/**
 * Single-flight configure of a project's managed build directory (KTD3). A trigger while a run is in
 * flight queues exactly one rerun that every later trigger shares.
 */
export class ConfigureManager {
  private readonly root: string;
  private readonly exec: Exec;
  private readonly signal?: AbortSignal;
  private cmake?: CmakeVersion;
  private running?: Promise<ConfigureResult>;
  private queued?: Promise<ConfigureResult>;

  constructor(options: ConfigureManagerOptions) {
    this.root = options.root;
    this.exec = options.exec;
    this.signal = options.signal;
    this.cmake = options.cmake;
  }

  get configuring(): boolean {
    return this.running !== undefined;
  }

  trigger(): Promise<ConfigureResult> {
    if (this.queued) return this.queued;
    if (this.running) {
      this.queued = this.running.then(() => this.start());
      return this.queued;
    }
    return this.start();
  }

  private start(): Promise<ConfigureResult> {
    this.queued = undefined;
    const run: Promise<ConfigureResult> = this.run().finally(() => {
      if (this.running === run) this.running = undefined;
    });
    this.running = run;
    return run;
  }

  private result(fields: Partial<ConfigureResult> & Pick<ConfigureResult, "status" | "output">): ConfigureResult {
    const now = Date.now();
    return {
      sourceRoot: this.root, args: [], startedAt: now, finishedAt: now, exitCode: null, truncated: false,
      missingSources: [], reply: { newestIsError: false, newestFromThisRun: false }, notes: [], reusedFromOtherSession: false,
      ...fields,
    };
  }

  private async run(): Promise<ConfigureResult> {
    const cancelled = (fields: Partial<ConfigureResult> = {}) => this.result({ status: "cancelled", output: "CMake configure cancelled.", ...fields });
    try {
      if (this.signal?.aborted) return cancelled();
      this.cmake ??= await probeCmake(this.exec, this.signal);
      const cmake = this.cmake;
      if (!cmake || !isSupportedCmake(cmake)) {
        if (this.signal?.aborted) return cancelled();
        return this.result({ status: "failed", output: `CMake 3.14 or newer is required${cmake ? ` (found ${cmake.text})` : ", but cmake was not found"}.` });
      }
      const presets = await resolvePreset(this.root, this.exec, cmake, this.signal);
      const notes = [...presets.notes];
      const buildDir = managedBuildDir(this.root, presets.preset);
      const common = { buildDir, preset: presets.preset, notes };
      if (this.signal?.aborted) return cancelled(common);

      const lockPath = buildLockPath(buildDir);
      mkdirSync(dirname(buildDir), { recursive: true });
      let lock: LockInfo | undefined;
      while (!(lock = tryLock(lockPath))) {
        const owner = readLock(lockPath);
        if (owner === "missing") continue;
        if (owner === "corrupt" || !isAlive(owner.pid)) {
          rmSync(lockPath, { force: true });
          continue;
        }
        // Another session is configuring this directory: wait, then reuse its replies if it produced fresh ones.
        while (true) {
          try {
            await sleep(LOCK_POLL_MS, undefined, { signal: this.signal });
          } catch {
            return cancelled(common);
          }
          const current = readLock(lockPath);
          if (typeof current !== "object" || !sameLock(current, owner) || !isAlive(owner.pid)) break;
        }
        const reply = readReplyState(buildDir, owner.startedAt);
        if (reply.newest && !reply.newestIsError && reply.newestFromThisRun) {
          return this.result({
            ...common, status: "succeeded", output: "CMake configure reused from another pi session.",
            generator: readCacheVariables(buildDir).generator, startedAt: owner.startedAt, reply, reusedFromOtherSession: true,
          });
        }
      }

      try {
        return await this.configure(buildDir, presets, notes);
      } finally {
        releaseLock(lockPath, lock);
      }
    } catch (error) {
      return this.result({ status: "failed", output: `CMake configure could not run: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  private async configure(buildDir: string, presets: PresetResolution, notes: string[]): Promise<ConfigureResult> {
    let cache = readCacheVariables(buildDir);
    const explicitGenerator = presets.generator && !isMultiConfig(presets.generator) ? presets.generator : undefined;
    if (cache.generator && explicitGenerator && cache.generator !== explicitGenerator) {
      rmSync(buildDir, { recursive: true, force: true });
      notes.push(`Preset "${presets.preset}" now uses the ${explicitGenerator} generator instead of ${cache.generator}, so the managed build directory was recreated.`);
      cache = {};
    }
    // Reuse the cached generator so a later Ninja install cannot break an existing directory.
    const generator = cache.generator ?? explicitGenerator ?? (await this.hasNinja() ? "Ninja" : "Unix Makefiles");
    const args = ["-S", this.root, "-B", buildDir];
    if (presets.preset !== undefined) args.push("--preset", presets.preset);
    args.push("-G", generator, "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON");
    if (!presets.buildType && !cache.buildType) args.push("-DCMAKE_BUILD_TYPE=Debug");
    writeFileApiQueries(buildDir);

    const startedAt = Date.now();
    let result: ExecResult;
    try {
      result = await this.exec("cmake", args, { cwd: this.root, signal: this.signal, timeout: CONFIGURE_TIMEOUT_MS });
    } catch (error) {
      result = { stdout: "", stderr: error instanceof Error ? error.message : String(error), code: 1, killed: false };
    }
    const cancelled = this.signal?.aborted ?? false;
    const status: ConfigureStatus = cancelled ? "cancelled" : result.killed ? "timedOut" : result.code === 0 ? "succeeded" : "failed";
    const headline = {
      cancelled: "CMake configure cancelled.",
      timedOut: `CMake configure stopped after timeout (${CONFIGURE_TIMEOUT_MS / 1000} s).`,
      succeeded: "CMake configure succeeded.",
      failed: `CMake configure failed (exit code ${result.code}).`,
    }[status];
    const raw = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const bounded = boundedOutput(raw ? `${headline}\n${raw}` : headline);
    return this.result({
      status, buildDir, preset: presets.preset, generator, args, startedAt, exitCode: cancelled || result.killed ? null : result.code,
      output: bounded.text, truncated: bounded.truncated, logFile: bounded.logFile,
      missingSources: status === "failed" ? parseMissingSources(raw, this.root) : [],
      reply: readReplyState(buildDir, startedAt), notes,
    });
  }

  private async hasNinja(): Promise<boolean> {
    try {
      return (await this.exec("ninja", ["--version"], { signal: this.signal, timeout: PROBE_TIMEOUT_MS })).code === 0;
    } catch {
      return false;
    }
  }
}
