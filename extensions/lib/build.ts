import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 40_000;
const MAX_OUTPUT_LINES = 1_000;

const commonParameters = {
  build_dir: Type.Optional(Type.String({ minLength: 1, description: "Configured CMake build directory (default: build)" })),
  config: Type.Optional(Type.String({ minLength: 1, description: "Build configuration, for example Debug or Release" })),
  parallel: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum parallel jobs" })),
  timeout_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_MS, description: "Command timeout in milliseconds (default: 120000, maximum: 600000)" })),
};

interface Parameters {
  build_dir?: string;
  config?: string;
  parallel?: number;
  timeout_ms?: number;
  target?: string;
  regex?: string;
}

// Keep model-visible output bounded while preserving diagnostics for inspection.
function boundedOutput(output: string): { text: string; truncated: boolean; logFile?: string } {
  const lines = output.split("\n");
  const firstLines = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
  const bytes = Buffer.from(firstLines);
  const truncated = lines.length > MAX_OUTPUT_LINES || bytes.length > MAX_OUTPUT_BYTES;
  if (!truncated) return { text: output, truncated: false };
  let end = Math.min(bytes.length, MAX_OUTPUT_BYTES);
  // A byte cap must not split a UTF-8 character.
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  const logFile = join(mkdtempSync(join(tmpdir(), "pi-cpp-")), "output.log");
  writeFileSync(logFile, output, "utf8");
  return {
    text: `${bytes.subarray(0, end).toString("utf8")}\n\n[Output truncated. Full output saved to: ${logFile}]`,
    truncated: true,
    logFile,
  };
}

export function registerBuildTools(pi: ExtensionAPI): void {
  async function run(command: "cmake" | "ctest", params: Parameters, signal: AbortSignal | undefined, cwd: string) {
    const buildDir = params.build_dir ?? "build";
    const timeout = params.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const args = command === "cmake"
      ? ["--build", buildDir]
      : ["--test-dir", buildDir, "--output-on-failure", "--no-tests=error"];
    if (command === "cmake" && params.target !== undefined) args.push("--target", params.target);
    if (command === "ctest" && params.regex !== undefined) args.push("--tests-regex", params.regex);
    if (params.config !== undefined) args.push(command === "cmake" ? "--config" : "--build-config", params.config);
    if (params.parallel !== undefined) args.push("--parallel", String(params.parallel));

    const details = {
      command, args, cwd, build_dir: buildDir, timeout_ms: timeout,
      exitCode: null as number | null, success: false, killed: false,
      cancelled: false, timedOut: false, truncated: false, logFile: undefined as string | undefined,
    };
    const failure = (text: string) => ({ content: [{ type: "text" as const, text }], details, isError: true });
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
      return failure(`timeout_ms must be an integer from 1 to ${MAX_TIMEOUT_MS}.`);
    }
    if (params.parallel !== undefined && (!Number.isInteger(params.parallel) || params.parallel < 1)) {
      return failure("parallel must be a positive integer.");
    }
    if (signal?.aborted) {
      details.cancelled = true;
      return failure(`${command} cancelled before execution.`);
    }
    try {
      const result = await pi.exec(command, args, { cwd, signal, timeout });
      details.exitCode = result.code;
      details.killed = result.killed;
      details.cancelled = signal?.aborted ?? false;
      details.timedOut = result.killed && !details.cancelled;
      details.success = result.code === 0 && !result.killed && !details.cancelled;
      const status = details.cancelled ? "cancelled"
        : details.timedOut ? `stopped after timeout (${timeout} ms)`
        : details.success ? "succeeded" : `failed (exit code ${result.code})`;
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      const bounded = boundedOutput(`${command} ${status}.${output ? `\n${output}` : ""}`);
      details.truncated = bounded.truncated;
      details.logFile = bounded.logFile;
      return { content: [{ type: "text" as const, text: bounded.text }], details, isError: !details.success };
    } catch (error) {
      details.cancelled = signal?.aborted ?? false;
      const bounded = boundedOutput(`${command} ${details.cancelled ? "cancelled" : "could not execute"}: ${error instanceof Error ? error.message : String(error)}`);
      details.truncated = bounded.truncated;
      details.logFile = bounded.logFile;
      return failure(bounded.text);
    }
  }

  pi.registerTool({
    name: "cpp_build",
    label: "C++ Build",
    description: "Build an already configured CMake build directory. Does not configure the project.",
    promptSnippet: "Build configured CMake projects with optional target, configuration, and parallel jobs",
    parameters: Type.Object({
      ...commonParameters,
      target: Type.Optional(Type.String({ minLength: 1, description: "CMake target to build (default: all default targets)" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      return run("cmake", params, signal, ctx.cwd);
    },
  });
  pi.registerTool({
    name: "cpp_test",
    label: "C++ Test",
    description: "Run CTest in an existing build directory, showing failing test output. Fails if no tests match. Build first with cpp_build.",
    promptSnippet: "Run CTest with optional test name regex, configuration, and parallel jobs",
    parameters: Type.Object({
      ...commonParameters,
      regex: Type.Optional(Type.String({ description: "Run tests whose names match this CTest regular expression" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      return run("ctest", params, signal, ctx.cwd);
    },
  });
}
