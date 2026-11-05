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

/** How long the output pipes may stay quiet after the program exits before they are dropped, as in pi. */
const EXIT_STDIO_GRACE_MS = 100;

/**
 * Runs a program the way pi's exec does: no shell, no stdin, SIGTERM on timeout or abort and SIGKILL
 * five seconds later. A program that cannot start is a failed run, never a thrown error.
 *
 * The run ends when the program exits and its output pipes close. A background process the program
 * left running can hold those pipes open indefinitely, so once the program has exited and the pipes
 * stay quiet for a moment, they are dropped and the run ends anyway.
 */
export const nodeExec: Exec = (command, args, options = {}) => new Promise<ExecResult>(resolve => {
  let stdout = "", stderr = "", killed = false;
  let timer: NodeJS.Timeout | undefined;
  let idle: NodeJS.Timeout | undefined;
  let exitCode: number | null = null;
  let exited = false, stdoutEnded = false, stderrEnded = false;
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
    clearTimeout(idle);
    options.signal?.removeEventListener("abort", kill);
    child.stdout.destroy();
    child.stderr.destroy();
    resolve({ stdout, stderr, code, killed });
  };
  const exitedCode = () => exitCode ?? 1;
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => finish(exitedCode()), EXIT_STDIO_GRACE_MS);
  };
  const finishIfDrained = () => { if (exited && stdoutEnded && stderrEnded) finish(exitedCode()); };
  if (options.signal?.aborted) kill(); else options.signal?.addEventListener("abort", kill, { once: true });
  if (options.timeout && options.timeout > 0) timer = setTimeout(kill, options.timeout);
  // Output still arriving after the exit keeps the run open, so its tail is not cut off.
  child.stdout.on("data", data => { stdout += data; if (exited) armIdle(); });
  child.stderr.on("data", data => { stderr += data; if (exited) armIdle(); });
  child.stdout.once("end", () => { stdoutEnded = true; finishIfDrained(); });
  child.stderr.once("end", () => { stderrEnded = true; finishIfDrained(); });
  child.on("error", () => finish(127));
  child.once("exit", code => {
    exited = true;
    exitCode = code;
    finishIfDrained();
    if (!done) armIdle();
  });
  child.once("close", code => finish(code ?? 1));
});
