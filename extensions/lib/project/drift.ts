import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type { Exec, MissingSource } from "./configure.ts";
import {
  bestRealPath, declaringLocation, isInSkippedDir, ownersOf,
  type DeclaringLocation, type ProjectModel, type ProjectSource, type ProjectTarget,
} from "./model.ts";
import { projectCacheDir } from "./root.ts";

/** Candidate collection stops after this long and the scan reports itself skipped (KTD6). */
export const DRIFT_SCAN_TIMEOUT_MS = 2_000;
export const DRIFT_SKIPPED_MESSAGE = "drift check skipped: project too large to scan in time";
export const DRIFT_NO_MODEL_MESSAGE = "unregistered files are not checked until the project has configured successfully once";

/** Source extensions that are drift candidates (R10). Headers never are (R13). */
const SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cxx"]);

export interface OwnerCandidate {
  target: string;
  /** Where to add the file: the line declaring the target's sources in that directory (KTD7). */
  location?: DeclaringLocation;
}

export interface UnregisteredFinding {
  kind: "unregistered";
  /** Absolute real path. */
  path: string;
  /** Likely owning targets, sorted by name; several on a tie, none when no CMakeLists.txt covers the directory. */
  candidates: OwnerCandidate[];
  /** No ancestor directory up to the root has a project target, so a new target or an add_subdirectory is needed. */
  uncovered: boolean;
  /** The owner collects sources with file(GLOB...), so a reconfigure, not an edit, may register the file (KTD8). */
  likelyGlob: boolean;
}

export interface MissingFinding {
  kind: "missing";
  /** Absolute path of the listed file that does not exist. */
  path: string;
  /** Project targets that list it; empty when only a failed configure reported it. */
  targets: string[];
  /** The CMake line that lists it. */
  location?: DeclaringLocation;
}

export type DriftFinding = UnregisteredFinding | MissingFinding;

/**
 * A source that belongs to no active target but is named in a CMake input, for example under
 * `if(WIN32)` or a disabled option. Informational: it is never a finding.
 */
export interface ReferencedSource {
  /** Absolute real path. */
  path: string;
  /** The CMake file that references it. */
  file: string;
  line: number;
}

export interface DriftReport {
  /** Unregistered and missing findings, sorted by path then kind. */
  findings: DriftFinding[];
  /** Sources referenced in CMake but not built in this configuration, sorted by path. */
  referenced: ReferencedSource[];
  /** How candidates were collected; absent when no candidate scan ran. */
  mode?: "git" | "walk";
  /** Set when unregistered files were not checked; `findings` then holds missing findings only. */
  skipped?: string;
}

export interface ScanDriftOptions {
  /** Source root (KTD18). */
  root: string;
  /** The current, or last good, project model. Without one only `missingSources` are reported. */
  model?: ProjectModel;
  /** Missing sources parsed from a failed configure (KTD22). */
  missingSources?: readonly MissingSource[];
  /** Runs `git ls-files`; pass pi.exec. */
  exec: Exec;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Candidates (KTD6)

const isWithin = (dir: string, path: string) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

type Collected = { mode: "git" | "walk"; files: string[] } | "timeout";

async function gitListing(root: string, exec: Exec, deadline: number, signal?: AbortSignal): Promise<string[] | "timeout" | undefined> {
  const remaining = deadline - Date.now();
  if (remaining <= 0 || signal?.aborted) return "timeout";
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  // Race the deadline too, so an executor that ignores the kill cannot hold the scan.
  const expired = new Promise<"timeout">(done => { timer = setTimeout(() => { controller.abort(); done("timeout"); }, remaining); });
  try {
    const result = await Promise.race([
      exec("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, signal: controller.signal, timeout: remaining }),
      expired,
    ]);
    if (result === "timeout" || controller.signal.aborted) return "timeout";
    // Not a work tree, or no git: fall back to the walk.
    if (result.code !== 0 || result.killed) return undefined;
    return result.stdout.split("\0").filter(Boolean).map(path => join(root, path));
  } catch {
    return controller.signal.aborted ? "timeout" : undefined;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function walk(root: string, keepDir: (dir: string) => boolean, deadline: number, signal?: AbortSignal): string[] | "timeout" {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    if (Date.now() > deadline || signal?.aborted) return "timeout";
    const dir = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      // Symlinked directories are not followed, so the walk cannot loop.
      if (entry.isDirectory()) { if (keepDir(path)) pending.push(path); }
      else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
    }
  }
  return files;
}

async function collectCandidates(root: string, model: ProjectModel, exec: Exec, signal?: AbortSignal): Promise<Collected> {
  const deadline = Date.now() + DRIFT_SCAN_TIMEOUT_MS;
  const excluded = [model.buildDir];
  try { excluded.push(projectCacheDir(root)); } catch { /* the root vanished; nothing to exclude */ }
  const skippedDirs = new Map<string, boolean>();
  // Directories, not files, go through the skip set: a file named build.cpp is still a source.
  const keepDir = (dir: string) => {
    let skipped = skippedDirs.get(dir);
    if (skipped === undefined) {
      skipped = excluded.some(path => isWithin(path, dir)) || isInSkippedDir(root, dir);
      skippedDirs.set(dir, skipped);
    }
    return !skipped;
  };

  const listed = await gitListing(root, exec, deadline, signal);
  if (listed === "timeout") return "timeout";
  const mode = listed ? "git" : "walk";
  const paths = listed ?? walk(root, keepDir, deadline, signal);
  if (paths === "timeout") return "timeout";

  const files: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    if (i % 256 === 0 && (Date.now() > deadline || signal?.aborted)) return "timeout";
    const path = paths[i];
    if (!SOURCE_EXTENSIONS.has(extname(path)) || !keepDir(dirname(path))) continue;
    // Git's index can list files that were deleted from disk.
    let real: string;
    try { real = realpathSync(path); } catch { continue; }
    files.push(real);
  }
  return { mode, files: [...new Set(files)] };
}

// ---------------------------------------------------------------------------
// Owner inference (KTD7) and glob classification (KTD8)

interface DirSources {
  target: ProjectTarget;
  count: number;
  first: ProjectSource;
}

class Owners {
  private readonly bySourceDir = new Map<string, Map<ProjectTarget, DirSources>>();
  private readonly byDefinitionDir = new Map<string, ProjectTarget[]>();
  private readonly model: ProjectModel;

  constructor(model: ProjectModel) {
    this.model = model;
    for (const target of model.targets) {
      if (!target.isProjectTarget) continue;
      const defined = this.byDefinitionDir.get(target.sourceDir) ?? [];
      defined.push(target);
      this.byDefinitionDir.set(target.sourceDir, defined);
      for (const source of target.sources) {
        if (source.isGenerated) continue;
        const dir = dirname(source.path);
        const targets = this.bySourceDir.get(dir) ?? new Map<ProjectTarget, DirSources>();
        const entry = targets.get(target);
        if (entry) entry.count++;
        else targets.set(target, { target, count: 1, first: source });
        this.bySourceDir.set(dir, targets);
      }
    }
  }

  /** Walk up from the file's directory to the nearest one where project targets own sources or are defined. */
  candidates(path: string): OwnerCandidate[] {
    const root = this.model.sourceRoot;
    const byName = (a: OwnerCandidate, b: OwnerCandidate) => a.target.localeCompare(b.target);
    for (let dir = dirname(path); isWithin(root, dir); dir = dirname(dir)) {
      const owning = this.bySourceDir.get(dir);
      if (owning && owning.size > 0) {
        const most = Math.max(...[...owning.values()].map(entry => entry.count));
        return [...owning.values()].filter(entry => entry.count === most).map(entry => {
          const location = declaringLocation(entry.first.backtrace, root) ?? declaringLocation(entry.target.backtrace, root);
          return location ? { target: entry.target.name, location } : { target: entry.target.name };
        }).sort(byName);
      }
      const defined = this.byDefinitionDir.get(dir);
      if (defined && defined.length > 0) {
        return defined.map(target => {
          const location = declaringLocation(target.backtrace, root);
          return location ? { target: target.name, location } : { target: target.name };
        }).sort(byName);
      }
      if (dir === root || dirname(dir) === dir) break;
    }
    return [];
  }
}

const escapeRegex = (text: string) => text.replace(/[.+^${}()|\\]/g, "\\$&");
const globComponent = (part: string) => escapeRegex(part).replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\[!/g, "[^");

/** Match a path against a CMake glob expression; GLOB_RECURSE applies the last component at any depth. */
function matchesGlob(expression: string, recurse: boolean, path: string): boolean {
  const parts = expression.split("/");
  const wildcard = parts.findIndex(part => /[*?[]/.test(part));
  // Compare real paths: CMake reports the directory as it was given.
  const fixed = wildcard < 0 ? parts.length - 1 : wildcard;
  const prefix = bestRealPath(parts.slice(0, fixed).join("/") || "/");
  const rest = parts.slice(fixed);
  const last = rest.pop()!;
  const pattern = [escapeRegex(prefix === "/" ? "" : prefix), ...rest.map(globComponent)].join("/");
  return new RegExp(`^${pattern}${recurse ? "(?:/.+)?" : ""}/${globComponent(last)}$`).test(path);
}

const GLOB_COMMAND = /(?:^|[^\w])file\s*\(\s*GLOB(?:_RECURSE)?(?:\s|\))/im;

// ---------------------------------------------------------------------------
// Referenced-but-inactive sources (user decision amending R10)

const FILE_NAME_CHAR = /[\w.+-]/;
const PATH_CHAR = /[\w.+\-/\\@~]/;

const stripComment = (line: string) => line.replace(/(^|\s)#.*$/, "$1");

interface CmakeText {
  file: string;
  lines: string[];
}

/**
 * The first CMake input line that names `path`. A reference after a variable (`${DIR}/x.cpp`)
 * matches by suffix; a literal one must resolve to `path` from the CMake file's directory or the
 * root, so a registered `main.cpp` elsewhere does not hide a new `tools/main.cpp`.
 */
function findReference(path: string, root: string, inputs: readonly CmakeText[]): ReferencedSource | undefined {
  const name = basename(path);
  for (const { file, lines } of inputs) {
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      for (let at = line.indexOf(name); at >= 0; at = line.indexOf(name, at + 1)) {
        const end = at + name.length;
        if ((at > 0 && FILE_NAME_CHAR.test(line[at - 1])) || (end < line.length && FILE_NAME_CHAR.test(line[end]))) continue;
        let start = at;
        while (start > 0 && PATH_CHAR.test(line[start - 1])) start--;
        const token = line.slice(start, end);
        const matches = line[start - 1] === "}"
          ? path.endsWith(token.startsWith("/") ? token : `/${token}`)
          : resolve(dirname(file), token) === path || resolve(root, token) === path;
        if (matches) return { path, file, line: index + 1 };
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Scan

function missingFindings(model: ProjectModel | undefined, missingSources: readonly MissingSource[]): MissingFinding[] {
  const found = new Map<string, MissingFinding>();
  if (model) {
    for (const target of model.targets) {
      if (!target.isProjectTarget) continue;
      for (const source of target.sources) {
        // Generated sources do not exist until a build produces them (KTD6).
        if (source.isGenerated || existsSync(source.path)) continue;
        const finding = found.get(source.path) ?? { kind: "missing", path: source.path, targets: [] };
        if (!finding.targets.includes(target.name)) finding.targets.push(target.name);
        if (!finding.location) {
          const location = declaringLocation(source.backtrace, model.sourceRoot);
          if (location) finding.location = location;
        }
        found.set(source.path, finding);
      }
    }
  }
  // A failed configure reports the current text, so its line wins over a stale model's (KTD22).
  for (const missing of missingSources) {
    const path = bestRealPath(missing.path);
    const file = bestRealPath(missing.file);
    const finding = found.get(path) ?? { kind: "missing", path, targets: [] };
    if (finding.location?.file !== file || finding.location.line !== missing.line) finding.location = { file, line: missing.line };
    found.set(path, finding);
  }
  for (const finding of found.values()) finding.targets.sort();
  return [...found.values()];
}

const byPathThenKind = (a: DriftFinding, b: DriftFinding) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);

/**
 * Compare the project tree with the model (R10, R11, R13, R14): sources in no project target are
 * unregistered, with likely owners and the line to edit; listed sources absent on disk are missing.
 * Sources named in CMake text but not built in this configuration go to `referenced`, not findings.
 */
export async function scanDrift(options: ScanDriftOptions): Promise<DriftReport> {
  const { model, exec, signal } = options;
  const root = bestRealPath(options.root);
  const missing = missingFindings(model, options.missingSources ?? []);
  if (!model) return { findings: missing.sort(byPathThenKind), referenced: [], skipped: DRIFT_NO_MODEL_MESSAGE };

  const collected = await collectCandidates(root, model, exec, signal);
  if (collected === "timeout") return { findings: missing.sort(byPathThenKind), referenced: [], skipped: DRIFT_SKIPPED_MESSAGE };

  const owners = new Owners(model);
  const texts = new Map<string, string>();
  const textOf = (file: string) => {
    let text = texts.get(file);
    if (text === undefined) {
      try { text = readFileSync(file, "utf8"); } catch { text = ""; }
      texts.set(file, text);
    }
    return text;
  };
  let inputs: CmakeText[] | undefined;
  const cmakeTexts = () => inputs ??= model.cmakeInputs
    .filter(file => basename(file) === "CMakeLists.txt" || file.endsWith(".cmake"))
    .map(file => ({ file, lines: textOf(file).split(/\r?\n/).map(stripComment) }));
  const hasGlob = (file: string) => GLOB_COMMAND.test(textOf(file).split(/\r?\n/).map(stripComment).join("\n"));

  const findings: DriftFinding[] = [...missing];
  const referenced: ReferencedSource[] = [];
  for (const path of collected.files) {
    if (!isWithin(root, path) || ownersOf(model, path).some(target => target.isProjectTarget)) continue;
    const reference = findReference(path, root, cmakeTexts());
    if (reference) { referenced.push(reference); continue; }
    const candidates = owners.candidates(path);
    const likelyGlob = candidates.length > 0 && (
      (model.globsDependent ?? []).some(glob => matchesGlob(glob.expression, glob.recurse, path))
      || candidates.some(candidate => candidate.location !== undefined && hasGlob(candidate.location.file)));
    findings.push({ kind: "unregistered", path, candidates, uncovered: candidates.length === 0, likelyGlob });
  }
  referenced.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { findings: findings.sort(byPathThenKind), referenced, mode: collected.mode };
}

// ---------------------------------------------------------------------------
// Ledger

/** Findings are identified by kind and path (KTD6). */
export const findingKey = (finding: DriftFinding) => `${finding.kind}\0${finding.path}`;

export interface DriftDelta {
  /** Findings not reported before in this session. */
  new: DriftFinding[];
  /** Findings reported before that no longer hold. */
  resolved: DriftFinding[];
  /** Every finding open after this update, including the new ones. */
  open: DriftFinding[];
}

/**
 * Per-session record of reported findings, so each report point emits only what changed. Referenced
 * (inactive) sources never enter it. When unregistered files were not checked (`report.skipped`),
 * open unregistered findings stay open rather than resolving.
 */
export class FindingsLedger {
  private reported = new Map<string, DriftFinding>();

  update(report: DriftReport): DriftDelta {
    const current = new Map(report.findings.map(finding => [findingKey(finding), finding] as const));
    if (report.skipped !== undefined) {
      for (const [key, finding] of this.reported) {
        if (finding.kind === "unregistered" && !current.has(key)) current.set(key, finding);
      }
    }
    const added = [...current].filter(([key]) => !this.reported.has(key)).map(([, finding]) => finding);
    const resolved = [...this.reported].filter(([key]) => !current.has(key)).map(([, finding]) => finding);
    this.reported = current;
    return { new: added.sort(byPathThenKind), resolved: resolved.sort(byPathThenKind), open: this.open };
  }

  /** Findings currently open, for the briefing. */
  get open(): DriftFinding[] {
    return [...this.reported.values()].sort(byPathThenKind);
  }
}
