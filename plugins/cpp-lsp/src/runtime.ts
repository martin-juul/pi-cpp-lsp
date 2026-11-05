import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Exec, ExecResult } from "../../../packages/core/src/exec.ts";
import { configureHarness } from "../../../packages/core/src/harness.ts";
import type { UntrustedWording } from "../../../packages/core/src/project/session.ts";

/** The command that enables the plugin for a project. */
export const TRUST_COMMAND = "/cpp-lsp:trust";

/** Why a CMake project the user has not enabled gets nothing, and how to enable it. */
export const UNTRUSTED: UntrustedWording = {
  reason: "the cpp-lsp plugin is not enabled for it, and configuring it would run the project's CMake code",
  steps: `run ${TRUST_COMMAND}`,
  // Enabling takes effect in the running session, unlike pi's trust, which needs a restart.
  until: "until you enable the plugin here",
};

/**
 * The plugin's words in the core's shared text, and its own cache, so pi and Claude Code never share
 * a managed build directory on one project. Call it before building any session or tool.
 */
export function usePluginWording(): void {
  configureHarness({ notePrefix: "cpp-lsp:", presetCommand: "/cpp-lsp:cpp-preset", logName: "cpp-lsp", cacheName: "cpp-lsp-claude" });
}

/** The message of a caught error, or the thrown value as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether the module at `moduleUrl` is the script node was started with, rather than an import. */
export function isEntry(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/**
 * Runs a program the way pi's exec does: no shell, no stdin, SIGTERM on timeout or abort and SIGKILL
 * five seconds later. A program that cannot start is a failed run, never a thrown error.
 */
export const nodeExec: Exec = (command, args, options = {}) => new Promise<ExecResult>(resolve => {
  let stdout = "", stderr = "", killed = false;
  let timer: NodeJS.Timeout | undefined;
  const child = spawn(command, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const kill = () => {
    if (killed) return;
    killed = true;
    child.kill("SIGTERM");
    setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 5000).unref();
  };
  let done = false;
  const finish = (code: number) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", kill);
    resolve({ stdout, stderr, code, killed });
  };
  if (options.signal?.aborted) kill(); else options.signal?.addEventListener("abort", kill, { once: true });
  if (options.timeout && options.timeout > 0) timer = setTimeout(kill, options.timeout);
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  child.on("error", () => finish(127));
  child.on("close", code => finish(code ?? 1));
});
