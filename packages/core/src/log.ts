import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectCacheDir } from "./project/root.ts";

/** The log in the project's managed cache directory, for what the extension could not do. */
export const LOG_FILE = "pi-cpp-lsp.log";
/** Past this size, the log keeps its newer half. */
const MAX_LOG_BYTES = 512 * 1024;

/** Records one line; never throws. */
export type Log = (message: string) => void;

/**
 * A log for the CMake project at `root`. What the extension could not do (a feature clangd lacks, a
 * probe that failed, a file the compiler could not check) goes here rather than into tool results,
 * so results stay free of notes that repeat on every call.
 */
export function projectLog(root: string): Log {
  return message => {
    try {
      const dir = projectCacheDir(root);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, LOG_FILE);
      let size = 0;
      try { size = statSync(file).size; } catch { /* no log yet */ }
      if (size > MAX_LOG_BYTES) {
        const text = readFileSync(file, "utf8");
        writeFileSync(file, text.slice(text.indexOf("\n", text.length >> 1) + 1));
      }
      appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
    } catch { /* logging must never break a tool */ }
  };
}
