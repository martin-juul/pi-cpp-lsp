import { homedir } from "node:os";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ClangdConnection, Diagnostic } from "./clangd.ts";
import { probeInvocation, resolveCompileInvocation, type CompilationEntry } from "./compdb.ts";
import { plural } from "./output.ts";
import type { Exec } from "./exec.ts";
import type { ProjectService } from "./project/session.ts";
import { featureLabels, type TargetProfile, type ToolchainService, HEADER_EXTENSIONS } from "./toolchain.ts";
import type { Log } from "./log.ts";

/** How long a write or edit waits for clangd's diagnostics at the synced version (KTD13 step 4). */
export const DIAGNOSTICS_WAIT_MS = 3_000;
/** The bound for the first open of a translation unit, which has to build its preamble. */
export const FIRST_OPEN_WAIT_MS = 8_000;
/** Diagnostics listed per file; errors come first. */
export const MAX_DIAGNOSTICS = 20;
/**
 * The bound for the build compiler's syntax check after an edit: half of cpp_compile's 30 seconds,
 * because it runs inside every edit that clangd finds errors in.
 */
export const COMPILER_CHECK_TIMEOUT_MS = 15_000;

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

/**
 * The parts of the project service the pipeline uses; without reportPoint the drift step is skipped.
 * The model's build directory picks the compilation database for the compiler check, as it does for cpp_compile.
 */
export type PostEditProject = Pick<ProjectService, "ownerOf"> & Partial<Pick<ProjectService, "reportPoint" | "model">>;

export interface PostEditOptions {
  /** Runs clang-format. */
  exec: Exec;
  /** The working directory diagnostics paths are shown relative to. */
  cwd: string;
  /** The session's project service; without one the drift and owner steps are skipped. */
  project?: PostEditProject;
  /** The session's managed clangd (ManagedClangd); without a connection diagnostics are skipped silently. */
  clangd?: PostEditClangd;
  /** Wait bound for diagnostics; defaults to DIAGNOSTICS_WAIT_MS. */
  waitMs?: number;
  /** Wait bound for a file's first open on a connection; defaults to FIRST_OPEN_WAIT_MS. */
  firstOpenWaitMs?: number;
  /**
   * The session's toolchain service. When clangd reports errors in a file whose target's build
   * compiler supports features clangd lacks, that compiler checks the file instead.
   */
  toolchain?: Pick<ToolchainService, "gapProfileFor">;
  /** Where a compiler check that could not run is recorded. */
  log?: Log;
}

type PostEditClangd = { connection(): Promise<ClangdConnection | undefined> };

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

/** `file` relative to `cwd` when it lies under it, else `file` itself (also for `cwd` itself). */
export function cwdDisplayPath(cwd: string, file: string): string {
  const path = relative(cwd, file);
  return path && !path.startsWith("..") && !isAbsolute(path) ? path : file;
}

/** One listed problem: a 1-based position, 1 for errors and 2 for warnings. */
interface Problem {
  path: string;
  line: number;
  column: number;
  severity: 1 | 2;
  message: string;
}

/** The diagnostics lines for problems already in order: a summary, then the problems, capped. */
function renderProblems(problems: Problem[]): string[] {
  if (problems.length === 0) return ["diagnostics: no problems"];
  const errors = problems.filter(problem => problem.severity === 1).length;
  const counts = [errors > 0 ? plural(errors, "error") : "", problems.length > errors ? plural(problems.length - errors, "warning") : ""].filter(Boolean).join(", ");
  const capped = problems.length > MAX_DIAGNOSTICS ? ` (first ${MAX_DIAGNOSTICS} shown)` : "";
  return [
    `diagnostics: ${counts}${capped}`,
    ...problems.slice(0, MAX_DIAGNOSTICS).map(({ path, line, column, severity, message }) => `${path}:${line}:${column}: ${SEVERITY[severity - 1]}: ${message}`),
  ];
}

/** The diagnostics lines for one answer: a summary, then errors before warnings, capped. */
function renderDiagnostics(diagnostics: Diagnostic[], path: string): string[] {
  // An omitted severity is the client's choice; treat it as an error rather than hide it.
  const problems = diagnostics
    .map(diagnostic => ({ diagnostic, severity: diagnostic.severity ?? 1 }))
    .filter((entry): entry is { diagnostic: Diagnostic; severity: 1 | 2 } => entry.severity === 1 || entry.severity === 2)
    .sort((a, b) => a.severity - b.severity
      || a.diagnostic.range.start.line - b.diagnostic.range.start.line
      || a.diagnostic.range.start.character - b.diagnostic.range.start.character);
  return renderProblems(problems.map(({ diagnostic, severity }) => ({
    path,
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
    severity,
    message: diagnostic.message.replace(/\r?\n/g, "\n  "),
  })));
}

/** One error or warning line of a compiler's plain-text output. */
export interface CompilerProblem {
  /** Absolute path, resolved against the compiler's working directory. */
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
}

const COMPILER_LINE = /^(.+?):(\d+):(\d+): (fatal error|error|warning): (.*)$/;

/**
 * The `path:line:col: error|warning: message` lines of GCC or clang output (a fatal error counts as
 * an error). Notes, caret and source lines, "In file included from" and "In function" context are dropped.
 */
export function parseCompilerOutput(output: string, cwd: string): CompilerProblem[] {
  const problems: CompilerProblem[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = COMPILER_LINE.exec(line);
    if (!match) continue;
    problems.push({
      file: resolve(cwd, match[1]!),
      line: Number(match[2]),
      column: Number(match[3]),
      severity: match[4] === "warning" ? "warning" : "error",
      message: match[5]!,
    });
  }
  return problems;
}

/** The diagnostics lines for a compiler's problems, in the post-edit note's format; paths relative to `cwd`. */
export function renderCompilerProblems(problems: CompilerProblem[], cwd: string): string[] {
  const listed = problems.map((problem): Problem => ({ ...problem, path: cwdDisplayPath(cwd, problem.file), severity: problem.severity === "error" ? 1 : 2 }));
  return renderProblems([...listed.filter(problem => problem.severity === 1), ...listed.filter(problem => problem.severity === 2)]);
}

export interface CompilerCheckOptions {
  /** Runs the compiler. */
  exec: Exec;
  /** The session's working directory, which a relative buildDir is resolved against. */
  cwd: string;
  /** The directory holding the compilation database a source's compile command comes from. */
  buildDir?: string;
  /** Defaults to COMPILER_CHECK_TIMEOUT_MS. */
  timeoutMs?: number;
  /** The compilation database already loaded, by canonical source path, for checking many files. */
  entries?: Map<string, CompilationEntry>;
}

export type CompilerCheck = { ok: true; problems: CompilerProblem[] } | { ok: false; reason: string };

/** The flags that make the profile's compiler print one plain line per diagnostic. */
function plainOutputFlags(profile: TargetProfile): string[] {
  if (profile.family === "gcc") return ["-fdiagnostics-plain-output"];
  if (profile.family === "clang") return ["-fno-color-diagnostics", "-fno-caret-diagnostics"];
  return [];
}

/**
 * A source runs its own compilation database entry, the way cpp_compile does. A header has no
 * entry, so it borrows the target's compile command and is compiled on its own as C++.
 */
function compilerInvocation(file: string, profile: TargetProfile, options: CompilerCheckOptions): { compiler: string; args: string[]; cwd: string } {
  const plain = plainOutputFlags(profile);
  if (HEADER_EXTENSIONS.has(extname(file).toLowerCase())) {
    if (!profile.entry) throw new Error(`target ${profile.target} has no compile command to borrow for a header`);
    const { compiler, args, cwd } = probeInvocation(profile.entry);
    return { compiler, args: [...args, "-x", "c++", "-Wno-pragma-once-outside-header", ...plain, "-fsyntax-only", file], cwd };
  }
  const entry = options.entries?.get(file);
  if (entry) {
    const { compiler, args, cwd } = probeInvocation(entry);
    return { compiler, args: [...args, file, "-fsyntax-only", ...plain], cwd };
  }
  const { compiler, args, cwd } = resolveCompileInvocation(options.cwd, { file, build_dir: options.buildDir });
  return { compiler, args: [...args, ...plain], cwd };
}

/**
 * Syntax-checks `file` with the build compiler of its target's profile, within the time limit.
 * Not ok when the compiler cannot run, is killed at the limit, or fails without reporting an error.
 */
export async function checkWithCompiler(file: string, profile: TargetProfile, options: CompilerCheckOptions): Promise<CompilerCheck> {
  const timeoutMs = options.timeoutMs ?? COMPILER_CHECK_TIMEOUT_MS;
  try {
    const { compiler, args, cwd } = compilerInvocation(file, profile, options);
    const result = await options.exec(compiler, args, { cwd, timeout: timeoutMs });
    if (result.killed) return { ok: false, reason: `it did not finish within ${Math.round(timeoutMs / 100) / 10}s` };
    const output = `${result.stderr}\n${result.stdout}`;
    const problems = parseCompilerOutput(output, cwd);
    // A failing run with no error line never got to the file, e.g. an unknown flag or a missing compiler.
    if (result.code !== 0 && !problems.some(problem => problem.severity === "error")) {
      return { ok: false, reason: output.trim().split("\n")[0] || `exit ${result.code}` };
    }
    return { ok: true, problems };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

/**
 * KTD13 steps 3 and 4: sync the file to the managed clangd and wait for its diagnostics at that
 * version, with the number of errors among them. Undefined when clangd is unavailable; a timeout
 * reads "diagnostics pending".
 */
async function diagnose(file: string, clangd: PostEditClangd, options: PostEditOptions): Promise<{ lines: string[]; errors: number } | undefined> {
  const waitMs = options.waitMs ?? DIAGNOSTICS_WAIT_MS;
  const firstOpenWaitMs = options.firstOpenWaitMs ?? FIRST_OPEN_WAIT_MS;
  const started = Date.now();
  const pending = (bound: number) => ({ lines: [`diagnostics pending (clangd did not answer within ${Math.round(bound / 100) / 10}s)`], errors: 0 });
  // A connection still starting counts against the first-open bound.
  const got = await within(clangd.connection().catch(() => undefined), firstOpenWaitMs);
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
    const errors = result.diagnostics.filter(diagnostic => (diagnostic.severity ?? 1) === 1).length;
    return { lines: renderDiagnostics(result.diagnostics, cwdDisplayPath(options.cwd, file)), errors };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * clangd's lines, unless clangd reported errors in a file whose target's build compiler supports
 * features clangd lacks: then that compiler's verdict and who gave it, or, when the compiler could
 * not check the file, clangd's lines with a warning that some of its errors may be false.
 */
async function verdict(file: string, clangd: { lines: string[]; errors: number }, options: PostEditOptions): Promise<string[]> {
  const profile = clangd.errors > 0 ? options.toolchain?.gapProfileFor(file) : undefined;
  if (!profile) return clangd.lines;
  const check = await checkWithCompiler(file, profile, { exec: options.exec, cwd: options.cwd, buildDir: options.project?.model?.buildDir });
  if (!check.ok) {
    options.log?.(uncheckedEntry(file, profile, check.reason));
    return clangd.lines;
  }
  return [...renderCompilerProblems(check.problems, options.cwd), checkedBy(profile)];
}

/** The line that says the build compiler, not clangd, judged a file. */
export function checkedBy(profile: TargetProfile): string {
  return `checked by ${profile.compiler ?? "the build compiler"}`;
}

/** The log entry for a file the build compiler could not judge; clangd's diagnostics stand for it. */
export function uncheckedEntry(file: string, profile: TargetProfile, reason: string): string {
  return `${file}: ${profile.compiler ?? "the build compiler"} could not check it, so clangd's diagnostics stand (clangd lacks ${featureLabels(profile.clangdLacks)}): ${reason}`;
}

/**
 * The post-edit pipeline for one written or edited file (KTD13): clang-format, the project report
 * point, then clangd diagnostics for C/C++ files. Returns the note lines, without the note prefix;
 * empty when there is nothing to say. Each step runs even when an earlier one fails.
 */
export async function postEditLines(file: string, options: PostEditOptions): Promise<string[]> {
  const cpp = isCppFile(file);
  const lines: string[] = [];
  if (cpp && await format(file, options.exec)) lines.push("Formatted with clang-format ✓");
  if (options.project) {
    if (options.project.reportPoint) {
      try {
        const drift = await options.project.reportPoint();
        if (drift) lines.push(drift.startsWith(`${NOTE_PREFIX} `) ? drift.slice(NOTE_PREFIX.length + 1) : drift);
      } catch { /* drift is reported at the next report point */ }
    }
    const owner = options.project.ownerOf(file);
    if (owner) lines.push(`owner ${owner.targets.join(", ")} (${owner.standardText})`);
  }
  if (cpp && options.clangd) {
    const diagnostics = await diagnose(file, options.clangd, options);
    if (diagnostics) lines.push(...await verdict(file, diagnostics, options));
  }
  return lines;
}

/** The note for postEditLines' lines: undefined when there are none. */
export function postEditText(lines: readonly string[]): string | undefined {
  return lines.length > 0 ? `${NOTE_PREFIX} ${lines.join("\n")}` : undefined;
}

/**
 * postEditLines as the combined note to append to the tool result, or undefined when there is
 * nothing to say. Call it for every file a tool changes, including files written outside pi's
 * write and edit tools.
 */
export async function postEditNote(file: string, options: PostEditOptions): Promise<string | undefined> {
  return postEditText(await postEditLines(file, options));
}
