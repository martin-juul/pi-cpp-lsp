import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bounded, position, waitFor, type ManagedClangd } from "./clangd.ts";
import { cwdDisplayPath, postEditLines, postEditText, type PostEditOptions } from "./diagnostics.ts";
import { plural } from "./output.ts";
import type { Exec } from "./project/configure.ts";
import { bestRealPath, isInSkippedDir, isWithin } from "./project/model.ts";
import { projectCacheDir } from "./project/root.ts";
import type { ProjectService } from "./project/session.ts";

/** How long a rename waits for clangd's background index to become idle (KTD14 step 2). */
export const INDEX_WAIT_MS = 30_000;

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
      // Without reportPoint the per-file pipeline skips the drift step.
      const perFile = { ownerOf: (path: string) => project.ownerOf(path) };
      const changed: { file: string; edits: number; note?: string }[] = [];
      const lines = [`Renamed to ${params.new_name} in ${plural(planned.length, "file")}:`];
      for (const entry of planned) {
        const noteLines = await postEditLines(entry.file, { exec: options.exec, cwd: ctx.cwd, project: perFile, clangd: managed, waitMs: options.waitMs, firstOpenWaitMs: options.firstOpenWaitMs });
        changed.push({ file: entry.file, edits: entry.edits, note: postEditText(noteLines) });
        lines.push(`${cwdDisplayPath(ctx.cwd, entry.file)}: ${plural(entry.edits, "edit")}`);
        if (noteLines.length > 0) lines.push(...noteLines.join("\n").split("\n").map(line => `  ${line}`));
      }
      const drift = await project.reportPoint().catch(() => undefined);
      if (drift) lines.push(drift);
      return { content: [{ type: "text" as const, text: bounded(lines.join("\n")) }], details: { ...base, changed, drift } };
    },
  });
}
