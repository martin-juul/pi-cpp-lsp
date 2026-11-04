import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bounded, position, waitFor, type ManagedClangd } from "./clangd.ts";
import {
  checkedBy, checkWithCompiler, COMPILER_CHECK_TIMEOUT_MS, cwdDisplayPath, MAX_DIAGNOSTICS, postEditLines, postEditText, renderCompilerProblems,
  uncheckedWarning, type CompilerCheck, type CompilerProblem, type PostEditOptions,
} from "./diagnostics.ts";
import { plural } from "./output.ts";
import type { Exec } from "./project/configure.ts";
import { bestRealPath, isInSkippedDir, isWithin, ownersOf, type ProjectModel } from "./project/model.ts";
import { projectCacheDir } from "./project/root.ts";
import type { ProjectService } from "./project/session.ts";
import type { TargetProfile, ToolchainService } from "./toolchain.ts";

/** How long a rename waits for clangd's background index to become idle (KTD14 step 2). */
export const INDEX_WAIT_MS = 30_000;
/** The whole compiler check after a rename finishes within this. */
export const RENAME_CHECK_MS = 60_000;
/** Compiles the check after a rename runs at once. */
const RENAME_CHECK_CONCURRENCY = 4;

const NO_PROJECT = "Rename needs the CMake project model and its managed clangd index, and none is ready: this is not a CMake project, or its configure is still running or failed. Check with cpp_project.";

/** The parts of the project service the rename uses. */
export type RenameProject = Pick<ProjectService, "model" | "reportPoint" | "ownerOf">;

/** cpp_rename's options; waitMs and firstOpenWaitMs bound the post-edit diagnostics (see PostEditOptions). */
export interface RenameToolOptions extends Pick<PostEditOptions, "waitMs" | "firstOpenWaitMs"> {
  /** Runs clang-format for the post-edit pipeline; pass pi.exec. */
  exec: Exec;
  /** The session's project service. */
  getProject: () => RenameProject | undefined;
  /** Bound for the index-idle wait; defaults to INDEX_WAIT_MS. */
  indexWaitMs?: number;
  /** Writes one file's new text; defaults to a temporary file renamed into place. */
  write?: (file: string, text: string) => Promise<void>;
  /**
   * The session's C++ feature profiles. In a project whose build compiler supports features clangd
   * lacks, clangd's index can miss uses in code that uses them, so the build compiler checks the
   * targets the rename can affect.
   */
  toolchain?: Pick<ToolchainService, "gapProfiles" | "gapProfileFor">;
  /** Bound for that check; defaults to RENAME_CHECK_MS. */
  renameCheckMs?: number;
}

interface BuildCheck {
  /** The verdict per checked file; a file missing here was not reached in time. */
  results: Map<string, CompilerCheck>;
  /** The gap targets whose sources were not all checked. */
  unchecked: string[];
  /** The gap targets the check covered, in model order. */
  targets: TargetProfile[];
}

/**
 * The gap targets a rename of `changed` can break: the owners of the changed files and every target
 * that depends on them, directly or not, keeping only gap targets, since clangd indexed the others in
 * full. A changed file no target lists, such as a header, could be included anywhere, so then every
 * gap target counts.
 */
function affectedGapTargets(model: ProjectModel, changed: string[], gaps: readonly TargetProfile[]): TargetProfile[] {
  const byName = new Map(gaps.map(profile => [profile.target, profile]));
  const affected = new Set<string>();
  let unowned = false;
  for (const file of changed) {
    const owners = ownersOf(model, file).filter(target => target.isProjectTarget);
    if (owners.length === 0) unowned = true;
    for (const owner of owners) affected.add(owner.name);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const target of model.targets) {
      if (!affected.has(target.name) && target.dependencies.some(dependency => affected.has(dependency))) {
        affected.add(target.name);
        grew = true;
      }
    }
  }
  return model.targets.map(target => byName.get(target.name)).filter((profile): profile is TargetProfile => !!profile && (unowned || affected.has(profile.target)));
}

/** Syntax-checks the C++ sources of `targets`, plus changed files of theirs that are not sources, within `limitMs`. */
async function buildCheck(model: ProjectModel, targets: TargetProfile[], changed: string[], toolchain: NonNullable<RenameToolOptions["toolchain"]>, options: { exec: Exec; cwd: string; limitMs: number }): Promise<BuildCheck> {
  const jobs: { file: string; profile: TargetProfile }[] = [];
  const queued = new Set<string>();
  const add = (file: string, profile: TargetProfile) => { if (!queued.has(file)) { queued.add(file); jobs.push({ file, profile }); } };
  for (const profile of targets) {
    const target = model.targets.find(candidate => candidate.name === profile.target);
    for (const source of target?.sources ?? []) if (source.language === "CXX" && !source.isGenerated) add(source.path, profile);
  }
  for (const file of changed) {
    const profile = toolchain.gapProfileFor(file);
    if (profile && targets.includes(profile)) add(file, profile);
  }
  const deadline = Date.now() + options.limitMs;
  const results = new Map<string, CompilerCheck>();
  const unchecked = new Set<string>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(RENAME_CHECK_CONCURRENCY, jobs.length) }, async () => {
    while (next < jobs.length) {
      const { file, profile } = jobs[next++]!;
      const remaining = deadline - Date.now();
      if (remaining <= 0) { unchecked.add(profile.target); continue; }
      const result = await checkWithCompiler(file, profile, { exec: options.exec, cwd: options.cwd, buildDir: model.buildDir, timeoutMs: Math.min(COMPILER_CHECK_TIMEOUT_MS, remaining) });
      // A compile cut off by the overall limit was not reached; any other failure is the file's verdict.
      if (!result.ok && Date.now() >= deadline) unchecked.add(profile.target);
      else results.set(file, result);
    }
  }));
  return { results, unchecked: targets.map(profile => profile.target).filter(name => unchecked.has(name)), targets };
}

const sameProblem = (a: CompilerProblem, b: CompilerProblem) => a.file === b.file && a.line === b.line && a.column === b.column && a.message === b.message;

/** The note lines of a changed file in a gap target: clangd's diagnostics give way to the compiler's verdict. */
function changedFileLines(file: string, noteLines: string[], profile: TargetProfile, check: CompilerCheck | undefined, cwd: string): string[] {
  // The post-edit pipeline adds clangd's diagnostics last.
  const index = noteLines.findIndex(line => line.startsWith("diagnostics"));
  const before = index < 0 ? noteLines : noteLines.slice(0, index);
  if (!check) return [...noteLines, uncheckedWarning(profile, "the check after the rename did not reach it in time")];
  if (!check.ok) return [...noteLines, uncheckedWarning(profile, check.reason)];
  return [...before, ...renderCompilerProblems(check.problems.filter(problem => problem.file === file), cwd), checkedBy(profile)];
}

/** The lines summing up the check: errors outside the changed files, whether the build may be broken, and what was not reached. */
function buildCheckLines(check: BuildCheck, changed: Set<string>, limitMs: number, cwd: string): string[] {
  const compilers = [...new Set(check.targets.map(profile => profile.compiler ?? "the build compiler"))].join(", ");
  const errors: CompilerProblem[] = [];
  let broken = false;
  for (const [file, result] of check.results) {
    if (!result.ok) continue;
    for (const problem of result.problems) {
      if (problem.severity !== "error") continue;
      broken = true;
      if (changed.has(problem.file) && problem.file === file) continue;
      if (!errors.some(seen => sameProblem(seen, problem))) errors.push(problem);
    }
  }
  const lines = [`Build check by ${compilers} of ${check.targets.map(profile => profile.target).join(", ")}, whose code clangd may not have indexed in full:`];
  if (errors.length > 0) {
    lines.push(...renderCompilerProblems(errors.slice(0, MAX_DIAGNOSTICS), cwd).slice(1).map(line => `  ${line}`));
    if (errors.length > MAX_DIAGNOSTICS) lines.push(`  [${errors.length - MAX_DIAGNOSTICS} more errors omitted]`);
  }
  if (broken) lines.push("  the build may be broken: fix these errors; the rename was not undone");
  else if (check.unchecked.length === 0) lines.push("  no errors");
  if (check.unchecked.length > 0) lines.push(`  not checked within ${Math.round(limitMs / 100) / 10}s: ${check.unchecked.join(", ")}`);
  return lines;
}

/** A reason to refuse the whole rename, naming the offending file when there is one; nothing has been written. */
class Refusal extends Error {
  path?: string;
  constructor(message: string, path?: string) {
    super(message);
    this.path = path;
  }
}

type Position = { line: number; character: number };
type TextEdit = { range: { start: Position; end: Position }; newText: string };

function pathOf(uri: unknown): string {
  if (typeof uri !== "string" || !uri.startsWith("file:")) throw new Refusal(`clangd returned an edit for a non-file location: ${String(uri)}`);
  return fileURLToPath(uri);
}

/** The text edits per real file path, from either WorkspaceEdit form. */
function editsByFile(edit: any): Map<string, TextEdit[]> {
  const files = new Map<string, TextEdit[]>();
  const add = (uri: unknown, edits: unknown) => {
    const file = bestRealPath(pathOf(uri));
    files.set(file, [...(files.get(file) ?? []), ...(Array.isArray(edits) ? edits : [])]);
  };
  if (Array.isArray(edit?.documentChanges)) {
    for (const change of edit.documentChanges) {
      if (typeof change?.kind === "string") throw new Refusal(`clangd's edit would ${change.kind} a file, and cpp_rename applies only text edits`);
      add(change?.textDocument?.uri, change?.edits);
    }
  } else if (edit?.changes && typeof edit.changes === "object") {
    for (const [uri, edits] of Object.entries(edit.changes)) add(uri, edits);
  }
  return files;
}

/** Offsets of each line start; LSP lines end at \n, \r\n or \r. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\r" && text[index + 1] === "\n") index++;
    if (char === "\n" || char === "\r") starts.push(index + 1);
  }
  return starts;
}

/** Applies `edits` (zero-based UTF-16 ranges) to `text` from the last to the first. */
function apply(file: string, text: string, edits: TextEdit[]): string {
  const starts = lineStarts(text);
  const offset = ({ line, character }: Position) => {
    const start = starts[line];
    const end = line + 1 < starts.length ? starts[line + 1]! : text.length;
    if (start === undefined || !Number.isInteger(character) || character < 0 || start + character > end) throw new Refusal(`file changed during rename: ${file} no longer matches clangd's edit positions`, file);
    return start + character;
  };
  const located = edits.map(edit => ({ start: offset(edit.range.start), end: offset(edit.range.end), text: String(edit.newText) }));
  located.sort((a, b) => b.start - a.start || b.end - a.end);
  let result = text;
  for (const edit of located) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

/** Writes through a temporary file in the same directory, renamed into place, keeping the file mode. */
async function atomicWrite(file: string, text: string): Promise<void> {
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    const { mode } = await stat(file);
    await writeFile(temp, text);
    await chmod(temp, mode & 0o7777);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Registers cpp_rename (R24, R28): a project-wide rename through the session's managed clangd,
 * validated in full before anything is written and then written all at once (KTD14). Any refusal
 * changes nothing and says why. Each changed file then goes through the post-edit pipeline, called
 * directly because tool hooks do not fire for these writes.
 */
export function registerRenameTool(pi: ExtensionAPI, managed: Pick<ManagedClangd, "connection">, options: RenameToolOptions): void {
  const write = options.write ?? atomicWrite;
  const indexWaitMs = options.indexWaitMs ?? INDEX_WAIT_MS;
  pi.registerTool({
    name: "cpp_rename", label: "C++ Rename",
    description: "Rename the C/C++ symbol at a position across the CMake project with clangd, editing every file that uses it. The rename is refused, changing nothing, when clangd cannot rename the symbol, its index is still building, or an edit would land outside the project or in a build or dependency directory. Lists every changed file with its clangd diagnostics.",
    promptSnippet: "Rename a C/C++ symbol across the project with clangd instead of editing each use",
    parameters: Type.Object({
      file: Type.String({ description: "Source or header path, absolute or relative to the project cwd" }),
      line: Type.Integer({ minimum: 1, description: "1-based line" }),
      column: Type.Integer({ minimum: 1, description: "1-based UTF-16 column (JavaScript string offsets + 1)" }),
      new_name: Type.String({ minLength: 1, description: "The new identifier" }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const base = { file: resolve(ctx.cwd, params.file), line: params.line, column: params.column, new_name: params.new_name };
      const refused = (message: string, path?: string) => {
        const text = bounded(`Rename refused: ${message}. No files were changed.`);
        return { isError: true, content: [{ type: "text" as const, text }], details: { ...base, refused: true, reason: message, path } };
      };

      // Steps 1–4: validate everything; nothing is written yet.
      let project: RenameProject;
      let planned: { file: string; original: string; text: string; edits: number }[];
      try {
        const input = await position(ctx.cwd, params);
        const connection = await waitFor(managed.connection(), signal);
        const current = options.getProject();
        const model = current?.model;
        if (!connection || !current || !model) throw new Error(NO_PROJECT);
        project = current;
        const prepared = await connection.request("textDocument/prepareRename", input.request, { file: input.file, signal });
        if (!prepared) throw new Refusal("clangd found no symbol to rename at this position");
        const state = await connection.waitForIndexIdle(indexWaitMs, signal);
        if (state !== "idle") {
          throw new Refusal(`clangd's project index is ${state === "indexing" ? "still building" : "not started"} after ${Math.round(indexWaitMs / 100) / 10}s, so the rename could miss uses; retry after indexing completes`);
        }
        const edit = await connection.request("textDocument/rename", { ...input.request, newName: params.new_name }, { file: input.file, signal });
        const files = editsByFile(edit);
        if (files.size === 0) throw new Refusal("clangd returned no edits for this rename");
        const root = bestRealPath(model.sourceRoot);
        const managedDirs = [bestRealPath(model.buildDir), bestRealPath(projectCacheDir(root))];
        for (const file of files.keys()) {
          if (!isWithin(root, file)) throw new Refusal(`an edit would land outside the project source root ${root}: ${file}`, file);
          if (managedDirs.some(dir => isWithin(dir, file))) throw new Refusal(`an edit would land in the managed build directory: ${file}`, file);
          if (isInSkippedDir(root, file)) throw new Refusal(`an edit would land in a build or dependency directory: ${file}`, file);
        }
        planned = [];
        for (const [file, edits] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
          const original = await readFile(file, "utf8");
          const synced = connection.syncedText(file);
          if (synced !== undefined && synced !== original) throw new Refusal(`file changed during rename: ${file}`, file);
          planned.push({ file, original, text: apply(file, original, edits), edits: edits.length });
        }
        // Step 5 starts here: last check that nothing moved while the new contents were computed.
        for (const entry of planned) {
          if (await readFile(entry.file, "utf8") !== entry.original) throw new Refusal(`file changed during rename: ${entry.file}`, entry.file);
        }
        if (signal?.aborted) throw new Error("rename cancelled");
      } catch (error) {
        return refused((error as Error).message, error instanceof Refusal ? error.path : undefined);
      }

      // Step 5: write all files; on a failure restore the ones already written.
      const written: typeof planned = [];
      for (const entry of planned) {
        try {
          await write(entry.file, entry.text);
          written.push(entry);
        } catch (error) {
          const unrestored: string[] = [];
          for (const done of written.reverse()) {
            try { await write(done.file, done.original); } catch { unrestored.push(done.file); }
          }
          const reason = `writing ${entry.file} failed: ${(error as Error).message}`;
          if (unrestored.length === 0) return refused(`${reason}; restored the ${plural(written.length, "file")} already written`, entry.file);
          const text = bounded(`Rename failed: ${reason}. These files still hold the renamed text and could not be restored:\n${unrestored.join("\n")}`);
          return { isError: true, content: [{ type: "text" as const, text }], details: { ...base, refused: false, reason, path: entry.file, unrestored } };
        }
      }

      // Step 6: format and diagnose each file. The drift report point runs once for the whole rename.
      // Without reportPoint the per-file pipeline skips the drift step. The pipeline gets no
      // toolchain: the build check below compiles every file at most once, within its own limit.
      const perFile = { ownerOf: (path: string) => project.ownerOf(path) };
      const notes = new Map<string, string[]>();
      for (const entry of planned) {
        notes.set(entry.file, await postEditLines(entry.file, { exec: options.exec, cwd: ctx.cwd, project: perFile, clangd: managed, waitMs: options.waitMs, firstOpenWaitMs: options.firstOpenWaitMs }));
      }

      const files = planned.map(entry => entry.file);
      const model = project.model;
      const gaps = options.toolchain?.gapProfiles ?? [];
      const targets = model && gaps.length > 0 ? affectedGapTargets(model, files, gaps) : [];
      const limitMs = options.renameCheckMs ?? RENAME_CHECK_MS;
      const check = model && targets.length > 0
        ? await buildCheck(model, targets, files, options.toolchain!, { exec: options.exec, cwd: ctx.cwd, limitMs })
        : undefined;

      const changed: { file: string; edits: number; note?: string }[] = [];
      const lines = [`Renamed to ${params.new_name} in ${plural(planned.length, "file")}:`];
      for (const entry of planned) {
        let noteLines = notes.get(entry.file)!;
        const profile = check ? options.toolchain!.gapProfileFor(entry.file) : undefined;
        if (check && profile && check.targets.includes(profile)) noteLines = changedFileLines(entry.file, noteLines, profile, check.results.get(entry.file), ctx.cwd);
        changed.push({ file: entry.file, edits: entry.edits, note: postEditText(noteLines) });
        lines.push(`${cwdDisplayPath(ctx.cwd, entry.file)}: ${plural(entry.edits, "edit")}`);
        if (noteLines.length > 0) lines.push(...noteLines.join("\n").split("\n").map(line => `  ${line}`));
      }
      if (check) lines.push(...buildCheckLines(check, new Set(files), limitMs, ctx.cwd));
      const drift = await project.reportPoint().catch(() => undefined);
      if (drift) lines.push(drift);
      const buildBroken = check ? [...check.results.values()].some(result => result.ok && result.problems.some(problem => problem.severity === "error")) : undefined;
      return { content: [{ type: "text" as const, text: bounded(lines.join("\n")) }], details: { ...base, changed, drift, ...(check ? { buildBroken, unchecked: check.unchecked } : {}) } };
    },
  });
}
