import type { Exec } from "../../../../packages/core/src/exec.ts";
import { setupLines } from "../../../../packages/core/src/setup.ts";
import type { ToolchainServiceOptions } from "../../../../packages/core/src/toolchain.ts";
import { isEntry, nodeExec, usePluginWording } from "../runtime.ts";

/** What `/cpp-lsp:cpp-setup` reports: the same lines as pi's /cpp-setup, in the plugin's words. */
export async function setupReport(exec: Exec, toolchain?: Pick<ToolchainServiceOptions, "clangd" | "clangdTimeoutMs">): Promise<string> {
  usePluginWording();
  return (await setupLines(exec, toolchain)).join("\n");
}

if (isEntry(import.meta.url)) {
  // A failing command aborts the whole skill, so even a crash is reported as text.
  try {
    console.log(await setupReport(nodeExec));
  } catch (error) {
    console.log(`cpp-lsp could not check the toolchain: ${error instanceof Error ? error.message : String(error)}`);
  }
}
