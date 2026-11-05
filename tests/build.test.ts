import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/index.ts";
import { registerBuildTools } from "./support/register.ts";
import type { ProjectModel } from "../packages/core/src/project/model.ts";

type Tool = {
  name: string;
  execute: (id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: { cwd: string }) => Promise<{
    content: { type: string; text: string }[];
    details: { command: string; args: string[]; build_dir: string; exitCode: number | null; success: boolean; killed: boolean; cancelled: boolean; timedOut: boolean; truncated: boolean; logFile?: string };
    isError: boolean;
  }>;
};
type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;
const success: ExecResult = { code: 0, stdout: "", stderr: "", killed: false };
function setup(exec: Exec = async () => success, project?: () => ProjectModel | undefined) {
  const tools = new Map<string, Tool>();
  registerBuildTools({ exec, registerTool: (tool: Tool) => tools.set(tool.name, tool) } as unknown as ExtensionAPI, project);
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

// ── Managed project defaults and cpp_run (KTD16, KTD17) ─────────────────────

const managedModel = { sourceRoot: "/src", buildDir: "/cache/pi-cpp-lsp/abc/builds/default", targets: [] } as unknown as ProjectModel;

test("build and test default to the managed directory when the model is ready, otherwise to build, and say which", async () => {
  const calls: string[][] = [];
  const exec: Exec = async (_command, args) => { calls.push(args); return success; };
  let model: ProjectModel | undefined = managedModel;
  const run = setup(exec, () => model);

  let result = await run("cpp_build", { target: "app" });
  assert.deepEqual(calls.at(-1), ["--build", managedModel.buildDir, "--target", "app"]);
  assert.equal(result.details.build_dir, managedModel.buildDir);
  assert.ok(result.content[0].text.includes(managedModel.buildDir), result.content[0].text);
  result = await run("cpp_test");
  assert.deepEqual(calls.at(-1), ["--test-dir", managedModel.buildDir, "--output-on-failure", "--no-tests=error"]);
  assert.ok(result.content[0].text.includes(managedModel.buildDir), result.content[0].text);

  model = undefined;
  result = await run("cpp_build");
  assert.deepEqual(calls.at(-1), ["--build", "build"]);
  assert.match(result.content[0].text, /Build directory: build\b/);
  result = await run("cpp_test");
  assert.deepEqual(calls.at(-1), ["--test-dir", "build", "--output-on-failure", "--no-tests=error"]);
});

test("an explicit build_dir always wins over the managed directory", async () => {
  const calls: string[][] = [];
  const run = setup(async (_command, args) => { calls.push(args); return success; }, () => managedModel);
  const result = await run("cpp_build", { build_dir: "out" });
  assert.deepEqual(calls.at(-1), ["--build", "out"]);
  assert.match(result.content[0].text, /Build directory: out\b/);
  await run("cpp_test", { build_dir: "out" });
  assert.deepEqual(calls.at(-1), ["--test-dir", "out", "--output-on-failure", "--no-tests=error"]);
});

// A child_process executor with pi.exec's contract: no shell, kill on abort or timeout.
const nodeExec: Exec = (command, args, options = {}) => new Promise<ExecResult>(resolve => {
  let stdout = "", stderr = "", killed = false;
  const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
  const kill = () => { killed = true; child.kill("SIGKILL"); };
  if (options.signal?.aborted) kill(); else options.signal?.addEventListener("abort", kill, { once: true });
  const timer = options.timeout ? setTimeout(kill, options.timeout) : undefined;
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  child.on("error", () => { clearTimeout(timer); resolve({ stdout, stderr, code: 127, killed }); });
  child.on("close", code => { clearTimeout(timer); resolve({ stdout, stderr, code: code ?? 1, killed }); });
});

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "cmake");
const hasCxx = spawnSync("c++", ["--version"]).status === 0;

/** A real extension session on a temp copy of the multi fixture, with the managed cache in a temp XDG_CACHE_HOME. */
async function multiSession(t: { after: (fn: () => unknown) => void }) {
  const previousCache = process.env.XDG_CACHE_HOME;
  const cache = realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-cache-")));
  process.env.XDG_CACHE_HOME = cache;
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-run-"))), "multi");
  cpSync(join(fixtures, "multi"), root, { recursive: true });
  writeFileSync(join(root, "app", "main.cpp"), `#include "legacy.h"
#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <thread>
int main(int argc, char** argv) {
  if (argc > 1 && std::strcmp(argv[1], "sleep") == 0) std::this_thread::sleep_for(std::chrono::seconds(30));
  std::printf("cwd:%s\\n", std::filesystem::current_path().c_str());
  for (int i = 1; i < argc; ++i) std::printf("arg:%s\\n", argv[i]);
  if (argc > 1 && std::strcmp(argv[1], "fail") == 0) return 3;
  return legacy_value() == 42 ? 0 : 1;
}
`);
  const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
  const tools = new Map<string, Tool>();
  extension({
    exec: nodeExec,
    registerTool(tool: Tool) { tools.set(tool.name, tool); },
    registerCommand() {},
    on(name: string, handler: (event: unknown, ctx: unknown) => unknown) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
  } as unknown as ExtensionAPI);
  const ctx = { cwd: root, isProjectTrusted: () => true, ui: { notify() {} } };
  const emit = async (name: string, event: Record<string, unknown>) => {
    for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
  };
  t.after(async () => {
    await emit("session_shutdown", { reason: "quit" });
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previousCache;
    rmSync(dirname(root), { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });
  await emit("session_start", { reason: "startup" });
  // The first run waits for the initial configure and loads the model.
  await emit("before_agent_start", { prompt: "hi", messageType: "user", systemPrompt: "", systemPromptOptions: { promptGuidelines: [] } });
  const call = (name: string, params: Record<string, unknown> = {}, signal?: AbortSignal) => tools.get(name)!.execute("call", params, signal, undefined, { cwd: root });
  return { root, cache, call };
}

test("real CMake: cpp_build and cpp_run use the managed directory and run the fixture executable", { skip: !hasCmake || !hasCxx }, async t => {
  const { root, cache, call } = await multiSession(t);

  const unbuilt = await call("cpp_run", { target: "app" });
  assert.equal(unbuilt.isError, true);
  assert.match(unbuilt.content[0].text, /not been built/);
  assert.match(unbuilt.content[0].text, /cpp_build/);

  const library = await call("cpp_run", { target: "legacy" });
  assert.equal(library.isError, true);
  assert.match(library.content[0].text, /library/);
  assert.match(library.content[0].text, /cpp_build/);

  const built = await call("cpp_build", { target: "app" });
  assert.equal(built.isError, false, built.content[0].text);
  assert.ok(built.details.build_dir.startsWith(join(cache, "pi-cpp-lsp")), built.details.build_dir);
  assert.ok(built.content[0].text.includes(built.details.build_dir), built.content[0].text);
  assert.equal(existsSync(join(root, "build")), false);

  const ran = await call("cpp_run", { target: "app", args: ["one", "two words"] });
  assert.equal(ran.isError, false, ran.content[0].text);
  assert.equal(ran.details.exitCode, 0);
  assert.match(ran.content[0].text, new RegExp(`^cwd:${root}$`, "m"));
  assert.match(ran.content[0].text, /arg:one\narg:two words/);
  assert.ok(ran.content[0].text.includes(built.details.build_dir), ran.content[0].text);

  const elsewhere = await call("cpp_run", { target: "app", cwd: "libs" });
  assert.match(elsewhere.content[0].text, new RegExp(`^cwd:${join(root, "libs")}$`, "m"));

  const failed = await call("cpp_run", { target: "app", args: ["fail"] });
  assert.equal(failed.isError, true);
  assert.equal(failed.details.exitCode, 3);
  assert.match(failed.content[0].text, /failed \(exit code 3\)/);
  assert.match(failed.content[0].text, /arg:fail/);

  const timedOut = await call("cpp_run", { target: "app", args: ["sleep"], timeout_ms: 300 });
  assert.equal(timedOut.isError, true);
  assert.equal(timedOut.details.timedOut, true);
  assert.equal(timedOut.details.cancelled, false);
  assert.match(timedOut.content[0].text, /stopped after timeout \(300 ms\)/);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  const cancelled = await call("cpp_run", { target: "app", args: ["sleep"] }, controller.signal);
  assert.equal(cancelled.isError, true);
  assert.equal(cancelled.details.cancelled, true);
  assert.equal(cancelled.details.timedOut, false);
  assert.match(cancelled.content[0].text, /cancelled/);

  const explicit = await call("cpp_build", { build_dir: "build" });
  assert.equal(explicit.isError, true);
  assert.equal(explicit.details.build_dir, "build");
  assert.match(explicit.content[0].text, /Build directory: build\b/);
});
