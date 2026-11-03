import { homedir } from "node:os";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ClangdConnection, Diagnostic } from "./clangd.ts";
import type { Exec } from "./project/configure.ts";
import type { ProjectService } from "./project/session.ts";

/** How long a write or edit waits for clangd's diagnostics at the synced version (KTD13 step 4). */
export const DIAGNOSTICS_WAIT_MS = 3_000;
/** The bound for the first open of a translation unit, which has to build its preamble. */
export const FIRST_OPEN_WAIT_MS = 8_000;
/** Diagnostics listed per file; errors come first. */
export const MAX_DIAGNOSTICS = 20;

const NOTE_PREFIX = "[cpp-lsp]";
const CPP_EXTENSIONS = new Set([".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".hh"]);
const SEVERITY = ["error", "warning"] as const;

/** Whether `file` is a C/C++ source or header, the files that get formatting and diagnostics. */
function isCppFile(file: string): boolean {
  return CPP_EXTENSIONS.has(extname(file).toLowerCase());
}

/** The absolute path a write or edit tool call wrote, resolved the way pi's tools resolve it. */
export function resolveToolPath(cwd: string, path: string): string {
  const stripped = path.startsWith("@") ? path.slice(1) : path;
  const expanded = stripped === "~" ? homedir() : stripped.startsWith("~/") ? `${homedir()}${stripped.slice(1)}` : stripped;
  return resolve(cwd, expanded);
}

/** The parts of the project service the pipeline uses. */
export type PostEditProject = Pick<ProjectService, "reportPoint" | "ownerOf">;

export interface PostEditOptions {
  /** Runs clang-format; pass pi.exec. */
  exec: Exec;
  /** The working directory diagnostics paths are shown relative to. */
  cwd: string;
  /** The session's project service; without one the drift and owner steps are skipped. */
  project?: PostEditProject;
  /** The session's managed clangd (ManagedClangd); without a connection diagnostics are skipped silently. */
  clangd?: { connection(): Promise<ClangdConnection | undefined> };
  /** Wait bound for diagnostics; defaults to DIAGNOSTICS_WAIT_MS. */
  waitMs?: number;
  /** Wait bound for a file's first open on a connection; defaults to FIRST_OPEN_WAIT_MS. */
  firstOpenWaitMs?: number;
}

/** Files each connection has synced through this pipeline; any other sync counts as a first open. */
const opened = new WeakMap<ClangdConnection, Set<string>>();

type Outcome<T> = { value: T } | undefined;

/** Resolves with the promise's value, or undefined once `ms` passes first. */
async function within<T>(promise: Promise<T>, ms: number): Promise<Outcome<T>> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<undefined>(done => { timer = setTimeout(() => done(undefined), Math.max(0, ms)); });
  try {
    return await Promise.race([promise.then(value => ({ value })), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function format(file: string, exec: Exec): Promise<boolean> {
  try {
    const result = await exec("clang-format", ["-i", file], { timeout: 10_000 });
    return result.code === 0;
  } catch {
    // clang-format not installed — silently skip
    return false;
  }
}

function displayPath(cwd: string, file: string): string {
  const path = relative(cwd, file);
  return path && !path.startsWith("..") && !isAbsolute(path) ? path : file;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The diagnostics lines for one answer: a summary, then errors before warnings, capped. */
function renderDiagnostics(diagnostics: Diagnostic[], path: string): string[] {
  // An omitted severity is the client's choice; treat it as an error rather than hide it.
  const problems = diagnostics
    .map(diagnostic => ({ diagnostic, severity: diagnostic.severity ?? 1 }))
    .filter(entry => entry.severity === 1 || entry.severity === 2)
    .sort((a, b) => a.severity - b.severity
      || a.diagnostic.range.start.line - b.diagnostic.range.start.line
      || a.diagnostic.range.start.character - b.diagnostic.range.start.character);
  if (problems.length === 0) return ["diagnostics: no problems"];
  const errors = problems.filter(entry => entry.severity === 1).length;
  const counts = [errors > 0 ? plural(errors, "error") : "", problems.length > errors ? plural(problems.length - errors, "warning") : ""].filter(Boolean).join(", ");
  const capped = problems.length > MAX_DIAGNOSTICS ? ` (first ${MAX_DIAGNOSTICS} shown)` : "";
  return [
    `diagnostics: ${counts}${capped}`,
    ...problems.slice(0, MAX_DIAGNOSTICS).map(({ diagnostic, severity }) => {
      const { line, character } = diagnostic.range.start;
      const message = diagnostic.message.replace(/\r?\n/g, "\n  ");
      return `${path}:${line + 1}:${character + 1}: ${SEVERITY[severity - 1]}: ${message}`;
    }),
  ];
}

/**
 * KTD13 steps 3 and 4: sync the file to the managed clangd and wait for its diagnostics at that
 * version. Undefined when clangd is unavailable; a timeout reads "diagnostics pending".
 */
async function diagnose(file: string, options: PostEditOptions): Promise<string[] | undefined> {
  const waitMs = options.waitMs ?? DIAGNOSTICS_WAIT_MS;
  const firstOpenWaitMs = options.firstOpenWaitMs ?? FIRST_OPEN_WAIT_MS;
  const started = Date.now();
  const pending = (bound: number) => [`diagnostics pending (clangd did not answer within ${Math.round(bound / 100) / 10}s)`];
  // A connection still starting counts against the first-open bound.
  const got = await within(options.clangd!.connection().catch(() => undefined), firstOpenWaitMs);
  if (!got) return pending(firstOpenWaitMs);
  const connection = got.value;
  if (!connection) return undefined;
  const seen = opened.get(connection) ?? new Set<string>();
  opened.set(connection, seen);
  const bound = seen.has(file) ? waitMs : firstOpenWaitMs;
  const deadline = started + bound;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  try {
    let version: number;
    try {
      ({ version } = await connection.syncFile(file, controller.signal));
    } catch {
      // A sync cut off by the bound is pending; any other failure means clangd is unavailable.
      return controller.signal.aborted ? pending(bound) : undefined;
    }
    seen.add(file);
    const result = await connection.waitForDiagnostics(file, version, Math.max(0, deadline - Date.now()));
    if (result.status === "pending") return pending(bound);
    return renderDiagnostics(result.diagnostics, displayPath(options.cwd, file));
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The post-edit pipeline for one written or edited file (KTD13): clang-format, the project report
 * point, then clangd diagnostics for C/C++ files. Returns the combined note to append to the tool
 * result, or undefined when there is nothing to say. Each step runs even when an earlier one fails.
 * Call it for every file a tool changes, including files written outside pi's write and edit tools.
 */
export async function postEditNote(file: string, options: PostEditOptions): Promise<string | undefined> {
  const cpp = isCppFile(file);
  const lines: string[] = [];
  if (cpp && await format(file, options.exec)) lines.push("Formatted with clang-format ✓");
  if (options.project) {
    try {
      const drift = await options.project.reportPoint();
      if (drift) lines.push(drift.startsWith(`${NOTE_PREFIX} `) ? drift.slice(NOTE_PREFIX.length + 1) : drift);
    } catch { /* drift is reported at the next report point */ }
    const owner = options.project.ownerOf(file);
    if (owner) lines.push(`owner ${owner.targets.join(", ")} (${owner.standardText})`);
  }
  if (cpp && options.clangd) {
    const diagnostics = await diagnose(file, options);
    if (diagnostics) lines.push(...diagnostics);
  }
  return lines.length > 0 ? `${NOTE_PREFIX} ${lines.join("\n")}` : undefined;
}
