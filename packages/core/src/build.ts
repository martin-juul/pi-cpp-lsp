import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Type } from "typebox";
import type { Exec } from "./exec.ts";
import { boundedOutput } from "./output.ts";
import { findTarget, type ProjectModel } from "./project/model.ts";
import { defineTool, type ToolSpec } from "./tools.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
/** Today's default when no CMake project model is ready (R27). */
const FALLBACK_BUILD_DIR = "build";

/**
 * The project model the build tools default to: the session's ready CMake model, or undefined to keep
 * today's defaults (KTD16). Read on every call, so it follows reconfigures and new sessions.
 */
export type ProjectModelSource = () => ProjectModel | undefined;

const timeoutParameter = Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_MS, description: "Command timeout in milliseconds (default: 120000, maximum: 600000)" }));
const commonParameters = {
  build_dir: Type.Optional(Type.String({ minLength: 1, description: "Configured CMake build directory (default: the extension's managed build directory when the CMake project model is ready, otherwise 'build')" })),
  config: Type.Optional(Type.String({ minLength: 1, description: "Build configuration, for example Debug or Release" })),
  parallel: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum parallel jobs" })),
  timeout_ms: timeoutParameter,
};

interface Parameters {
  build_dir?: string;
  config?: string;
  parallel?: number;
  timeout_ms?: number;
  target?: string;
  regex?: string;
}

interface RunParameters {
  target: string;
  args?: string[];
  cwd?: string;
  timeout_ms?: number;
}

/** One bounded process run: what to execute and the build directory it belongs to. */
interface Invocation {
  /** Names the process in the result text, e.g. "cmake" or the target. */
  label: string;
  command: string;
  args: string[];
  cwd: string;
  buildDir: string;
  timeout_ms?: number;
  parallel?: number;
  target?: string;
}

/** cpp_build, cpp_test and cpp_run. */
export function buildToolSpecs(exec: Exec, project: ProjectModelSource = () => undefined): ToolSpec[] {
  /** Explicit build_dir wins; otherwise the ready model's managed directory, otherwise "build" (KTD16). */
  const buildDirFor = (params: Parameters) => params.build_dir ?? project()?.buildDir ?? FALLBACK_BUILD_DIR;

  // Bounded output, timeout and cancellation shared by cpp_build, cpp_test and cpp_run.
  async function execute(invocation: Invocation, signal: AbortSignal | undefined) {
    const { label, command, args, cwd, buildDir, parallel } = invocation;
    const timeout = invocation.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const details = {
      command, args, cwd, build_dir: buildDir, timeout_ms: timeout,
      ...(invocation.target === undefined ? {} : { target: invocation.target }),
      exitCode: null as number | null, success: false, killed: false,
      cancelled: false, timedOut: false, truncated: false, logFile: undefined as string | undefined,
    };
    const where = `Build directory: ${buildDir}`;
    const failure = (text: string) => ({ content: [{ type: "text" as const, text }], details, isError: true });
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
      return failure(`timeout_ms must be an integer from 1 to ${MAX_TIMEOUT_MS}.`);
    }
    if (parallel !== undefined && (!Number.isInteger(parallel) || parallel < 1)) {
      return failure("parallel must be a positive integer.");
    }
    if (signal?.aborted) {
      details.cancelled = true;
      return failure(`${label} cancelled before execution. ${where}`);
    }
    try {
      const result = await exec(command, args, { cwd, signal, timeout });
      details.exitCode = result.code;
      details.killed = result.killed;
      details.cancelled = signal?.aborted ?? false;
      details.timedOut = result.killed && !details.cancelled;
      details.success = result.code === 0 && !result.killed && !details.cancelled;
      const status = details.cancelled ? "cancelled"
        : details.timedOut ? `stopped after timeout (${timeout} ms)`
        : details.success ? "succeeded" : `failed (exit code ${result.code})`;
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      const bounded = boundedOutput(`${label} ${status}. ${where}${output ? `\n${output}` : ""}`);
      details.truncated = bounded.truncated;
      details.logFile = bounded.logFile;
      return { content: [{ type: "text" as const, text: bounded.text }], details, isError: !details.success };
    } catch (error) {
      details.cancelled = signal?.aborted ?? false;
      const bounded = boundedOutput(`${label} ${details.cancelled ? "cancelled" : "could not execute"}: ${error instanceof Error ? error.message : String(error)}\n${where}`);
      details.truncated = bounded.truncated;
      details.logFile = bounded.logFile;
      return failure(bounded.text);
    }
  }

  async function run(command: "cmake" | "ctest", params: Parameters, signal: AbortSignal | undefined, cwd: string) {
    const buildDir = buildDirFor(params);
    const args = command === "cmake"
      ? ["--build", buildDir]
      : ["--test-dir", buildDir, "--output-on-failure", "--no-tests=error"];
    if (command === "cmake" && params.target !== undefined) args.push("--target", params.target);
    if (command === "ctest" && params.regex !== undefined) args.push("--tests-regex", params.regex);
    if (params.config !== undefined) args.push(command === "cmake" ? "--config" : "--build-config", params.config);
    if (params.parallel !== undefined) args.push("--parallel", String(params.parallel));
    return execute({ label: command, command, args, cwd, buildDir, timeout_ms: params.timeout_ms, parallel: params.parallel }, signal);
  }

  /** Resolves the target's executable from the model (KTD17) and runs it like cpp_build runs cmake. */
  async function runTarget(params: RunParameters, signal: AbortSignal | undefined, sessionCwd: string) {
    const error = (text: string) => ({
      content: [{ type: "text" as const, text }], details: { target: params.target, error: true }, isError: true,
    });
    const model = project();
    if (!model) {
      return error("cpp_run needs the CMake project model, which is not available: this is not a CMake project, or its first configure has not finished or failed.");
    }
    const target = findTarget(model, params.target);
    if (!target) {
      const runnable = model.targets.filter(candidate => candidate.kind === "executable" || candidate.kind === "test").map(candidate => candidate.name);
      return error(`Unknown target ${params.target}. Executable targets: ${runnable.join(", ") || "none"}.`);
    }
    if (target.kind !== "executable" && target.kind !== "test") {
      return error(`${target.name} is a ${target.kind} target (${target.type}), not an executable, so it cannot be run. Build it with cpp_build, and run an executable target that uses it.`);
    }
    const executable = target.artifacts[0];
    if (executable === undefined || !existsSync(executable)) {
      return error(`${target.name} has not been built${executable ? `: ${executable} does not exist` : ""}. Build it first with cpp_build (target: ${target.name}).`);
    }
    const cwd = params.cwd === undefined ? model.sourceRoot : resolve(sessionCwd, params.cwd);
    return execute({ label: target.name, command: executable, args: params.args ?? [], cwd, buildDir: model.buildDir, timeout_ms: params.timeout_ms, target: target.name }, signal);
  }

  const build = defineTool({
    name: "cpp_build",
    label: "C++ Build",
    description: "Build an already configured CMake build directory. Does not configure the project.",
    promptSnippet: "Build configured CMake projects with optional target, configuration, and parallel jobs",
    parameters: Type.Object({
      ...commonParameters,
      target: Type.Optional(Type.String({ minLength: 1, description: "CMake target to build (default: all default targets)" })),
    }),
    async execute(params, { cwd, signal }) {
      return run("cmake", params, signal, cwd);
    },
  });
  const test = defineTool({
    name: "cpp_test",
    label: "C++ Test",
    description: "Run CTest in an existing build directory, showing failing test output. Fails if no tests match. Build first with cpp_build.",
    promptSnippet: "Run CTest with optional test name regex, configuration, and parallel jobs",
    parameters: Type.Object({
      ...commonParameters,
      regex: Type.Optional(Type.String({ description: "Run tests whose names match this CTest regular expression" })),
    }),
    async execute(params, { cwd, signal }) {
      return run("ctest", params, signal, cwd);
    },
  });
  const runTool = defineTool({
    name: "cpp_run",
    label: "C++ Run",
    description: "Run a built executable target of the CMake project with arguments. Resolves the executable from the project model; build it first with cpp_build.",
    promptSnippet: "Run a CMake executable target with arguments, a working directory and a timeout",
    parameters: Type.Object({
      target: Type.String({ minLength: 1, description: "Executable target to run" }),
      args: Type.Optional(Type.Array(Type.String(), { description: "Arguments passed to the executable" })),
      cwd: Type.Optional(Type.String({ minLength: 1, description: "Working directory (default: the CMake source root)" })),
      timeout_ms: timeoutParameter,
    }),
    async execute(params, { cwd, signal }) {
      return runTarget(params, signal, cwd);
    },
  });
  return [build, test, runTool];
}
