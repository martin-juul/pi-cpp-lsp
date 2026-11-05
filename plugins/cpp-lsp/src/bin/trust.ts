import { findSourceRoot } from "../../../../packages/core/src/project/root.ts";
import { isEntry } from "../runtime.ts";
import { addTrusted, trustFile } from "../trust.ts";

/**
 * What `/cpp-lsp:trust` reports for `projectDir`. It enables the project's CMake root in the trust
 * list in `dataDir`; every outcome, a failure included, is a line for the user rather than an error,
 * because a failing command aborts the whole skill.
 */
export function trustReport(projectDir: string | undefined, dataDir: string | undefined): string {
  if (!projectDir) return "cpp-lsp could not tell which project to enable: Claude Code passed no project directory.";
  const root = findSourceRoot(projectDir);
  if (!root) return `${projectDir} is not a CMake project: no CMakeLists.txt was found in it or its parent directories, so there is nothing for cpp-lsp to enable.`;
  if (!dataDir) return `cpp-lsp could not enable ${root}: Claude Code passed no plugin data directory to remember it in.`;
  try {
    if (!addTrusted(dataDir, root)) return `cpp-lsp is already enabled for ${root}.`;
  } catch (error) {
    return `cpp-lsp could not enable ${root}: writing ${trustFile(dataDir)} failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  return `cpp-lsp is now enabled for ${root}. It configures the project with CMake in its own cache, and the next prompt carries the project briefing. New sessions in this project start enabled.`;
}

if (isEntry(import.meta.url)) {
  const [projectDir, dataDir] = process.argv.slice(2);
  try {
    console.log(trustReport(projectDir || process.env.CLAUDE_PROJECT_DIR, dataDir || process.env.CLAUDE_PLUGIN_DATA));
  } catch (error) {
    console.log(`cpp-lsp could not enable the project: ${error instanceof Error ? error.message : String(error)}`);
  }
}
