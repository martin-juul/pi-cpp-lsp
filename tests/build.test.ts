import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import { registerBuildTools } from "../extensions/lib/build.ts";

type Tool = {
  name: string;
  execute: (id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: { cwd: string }) => Promise<{
    content: { type: string; text: string }[];
    details: { command: string; args: string[]; exitCode: number | null; success: boolean; killed: boolean; cancelled: boolean; timedOut: boolean; truncated: boolean; logFile?: string };
    isError: boolean;
  }>;
};
type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;
const success: ExecResult = { code: 0, stdout: "", stderr: "", killed: false };
function setup(exec: Exec = async () => success) {
  const tools = new Map<string, Tool>();
  registerBuildTools({ exec, registerTool: (tool: Tool) => tools.set(tool.name, tool) } as unknown as ExtensionAPI);
  return (name: string, params: Record<string, unknown> = {}, signal?: AbortSignal, cwd = "/project with spaces") => tools.get(name)!.execute("call", params, signal, undefined, { cwd });
}

test("build uses configured directory, target, config, parallel and bounded timeout without a shell", async () => {
  const controller = new AbortController();
  const run = setup(async (command, args, options) => {
    assert.equal(command, "cmake");
    assert.deepEqual(args, ["--build", "out with spaces", "--target", "target; echo unsafe", "--config", "Debug", "--parallel", "3"]);
    assert.deepEqual(options, { cwd: "/project with spaces", signal: controller.signal, timeout: 42_000 });
    return success;
  });
  const result = await run("cpp_build", { build_dir: "out with spaces", target: "target; echo unsafe", config: "Debug", parallel: 3, timeout_ms: 42_000 }, controller.signal);
  assert.equal(result.isError, false);
  assert.equal(result.details.exitCode, 0);
  assert.match(result.content[0].text, /succeeded/);
});

test("test uses CTest arguments and default build directory and timeout", async () => {
  const run = setup(async (command, args, options) => {
    assert.equal(command, "ctest");
    assert.deepEqual(args, ["--test-dir", "build", "--output-on-failure", "--no-tests=error", "--tests-regex", "unit.*", "--build-config", "Release", "--parallel", "2"]);
    assert.equal(options?.timeout, 120_000);
    return success;
  });
  assert.equal((await run("cpp_test", { regex: "unit.*", config: "Release", parallel: 2 })).details.success, true);
});

test("nonzero exit status stays an error even without diagnostics", async () => {
  const result = await setup(async () => ({ ...success, code: 8 }))("cpp_test");
  assert.equal(result.isError, true);
  assert.equal(result.details.success, false);
  assert.equal(result.details.exitCode, 8);
  assert.match(result.content[0].text, /failed \(exit code 8\)/);
});

test("killed process cannot report success even if executor returns zero", async () => {
  const result = await setup(async () => ({ ...success, killed: true }))("cpp_build");
  assert.equal(result.isError, true);
  assert.equal(result.details.timedOut, true);
  assert.equal(result.details.success, false);
  assert.match(result.content[0].text, /timeout/);
});

test("cancellation is passed through and reported distinctly", async () => {
  const controller = new AbortController();
  const result = await setup(async (_command, _args, options) => {
    assert.equal(options?.signal, controller.signal);
    controller.abort();
    return { ...success, killed: true };
  })("cpp_build", {}, controller.signal);
  assert.equal(result.isError, true);
  assert.equal(result.details.cancelled, true);
  assert.equal(result.details.timedOut, false);
  assert.match(result.content[0].text, /cancelled/);
});

test("already cancelled calls and invalid numeric parameters do not launch commands", async () => {
  const run = setup(async () => { throw new Error("must not execute"); });
  const controller = new AbortController();
  controller.abort();
  assert.equal((await run("cpp_build", {}, controller.signal)).details.cancelled, true);
  for (const timeout_ms of [0, -1, 600_001, 1.5, NaN]) {
    assert.match((await run("cpp_build", { timeout_ms })).content[0].text, /timeout_ms must/);
  }
  for (const parallel of [0, -1, 1.5]) {
    assert.match((await run("cpp_test", { parallel })).content[0].text, /parallel must/);
  }
});

test("execution exceptions are errors with unknown exit code", async () => {
  const result = await setup(async () => { throw new Error("spawn ENOENT"); })("cpp_build");
  assert.equal(result.isError, true);
  assert.equal(result.details.exitCode, null);
  assert.match(result.content[0].text, /could not execute: spawn ENOENT/);
});

test("large output is bounded and full stdout/stderr diagnostics are saved", async () => {
  for (const stdout of ["diagnostic\n".repeat(2_000), "🙂".repeat(20_000)]) {
    const result = await setup(async () => ({ ...success, stdout, stderr: "final stderr", code: 1 }))("cpp_build");
    assert.equal(result.details.truncated, true);
    assert.ok(result.details.logFile);
    try {
      const text = result.content[0].text;
      assert.ok(Buffer.byteLength(text) < 41_000);
      assert.ok(text.split("\n").length < 1_010);
      assert.ok(!text.includes("�"));
      assert.match(text, /Full output saved to:/);
      const log = readFileSync(result.details.logFile, "utf8");
      assert.ok(log.includes(stdout));
      assert.ok(log.endsWith("final stderr"));
    } finally {
      rmSync(dirname(result.details.logFile), { recursive: true, force: true });
    }
  }
});

const hasCmake = spawnSync("cmake", ["--version"]).status === 0 && spawnSync("ctest", ["--version"]).status === 0;
test("real CMake fixture builds a target, runs selected tests, and rejects empty matches", { skip: !hasCmake }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-cpp-build test-"));
  try {
    writeFileSync(join(cwd, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.20)
project(BuildToolFixture NONE)
enable_testing()
add_custom_target(sample COMMAND "\${CMAKE_COMMAND}" -E echo "built sample")
add_test(NAME passing COMMAND "\${CMAKE_COMMAND}" -E true)
add_test(NAME failing COMMAND "\${CMAKE_COMMAND}" -E false)
`);
    const configure = spawnSync("cmake", ["-S", ".", "-B", "build"], { cwd, encoding: "utf8" });
    assert.equal(configure.status, 0, configure.stdout + configure.stderr);
    const run = setup(async (command, args, options) => {
      const result = spawnSync(command, args, { cwd: options?.cwd, timeout: options?.timeout, encoding: "utf8" });
      if (result.error) throw result.error;
      return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? 1, killed: result.signal !== null };
    });
    assert.equal((await run("cpp_build", { target: "sample", parallel: 2 }, undefined, cwd)).isError, false);
    assert.equal((await run("cpp_test", { regex: "^passing$" }, undefined, cwd)).isError, false);
    const failing = await run("cpp_test", { regex: "^failing$" }, undefined, cwd);
    assert.equal(failing.isError, true);
    assert.match(failing.content[0].text, /failing/);
    assert.equal((await run("cpp_test", { regex: "^missing$" }, undefined, cwd)).isError, true);
    assert.equal((await run("cpp_build", { build_dir: "unconfigured" }, undefined, cwd)).isError, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

const cCompiler = ["cc", "gcc", "clang"].find((command) => spawnSync(command, ["--version"]).status === 0);
test("real C project compiles and links an executable and reports a linker failure", { skip: !hasCmake || !cCompiler }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-cpp-link test-"));
  try {
    writeFileSync(join(cwd, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.20)
project(LinkToolFixture C)
enable_testing()
add_executable(working working.c)
add_executable(broken EXCLUDE_FROM_ALL broken.c)
add_test(NAME executable_passes COMMAND working)
`);
    writeFileSync(join(cwd, "working.c"), "int main(void) { return 0; }\n");
    writeFileSync(join(cwd, "broken.c"), "extern int missing_fixture_function(void);\nint main(void) { return missing_fixture_function(); }\n");
    const configure = spawnSync("cmake", ["-S", ".", "-B", "build", `-DCMAKE_C_COMPILER=${cCompiler}`], { cwd, encoding: "utf8" });
    assert.equal(configure.status, 0, configure.stdout + configure.stderr);
    const run = setup(async (command, args, options) => {
      const result = spawnSync(command, args, { cwd: options?.cwd, timeout: options?.timeout, encoding: "utf8" });
      if (result.error) throw result.error;
      return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? 1, killed: result.signal !== null };
    });
    const built = await run("cpp_build", { target: "working", parallel: 2 }, undefined, cwd);
    assert.equal(built.isError, false, built.content[0].text);
    const tested = await run("cpp_test", { regex: "^executable_passes$" }, undefined, cwd);
    assert.equal(tested.isError, false, tested.content[0].text);
    const linkFailure = await run("cpp_build", { target: "broken" }, undefined, cwd);
    assert.equal(linkFailure.isError, true);
    assert.equal(linkFailure.details.success, false);
    assert.notEqual(linkFailure.details.exitCode, 0);
    assert.match(linkFailure.content[0].text, /missing_fixture_function/);
    assert.match(linkFailure.content[0].text, /undefined reference|undefined symbol|unresolved external/i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
