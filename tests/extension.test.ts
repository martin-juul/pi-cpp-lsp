import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import extension, { type ExtensionOptions } from "../extensions/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

test("extension registers the complete tool set, the project session lifecycle and report points", () => {
  const tools: string[] = [];
  const events: string[] = [];
  const commands: string[] = [];
  extension({
    registerTool(tool: { name: string }) { tools.push(tool.name); },
    on(event: string) { events.push(event); },
    registerCommand(name: string) { commands.push(name); },
  } as unknown as ExtensionAPI);
  assert.deepEqual(tools.sort(), [
    "cpp_build", "cpp_calls", "cpp_check", "cpp_compile", "cpp_definition", "cpp_format",
    "cpp_gen_compdb", "cpp_hover", "cpp_project", "cpp_references", "cpp_rename", "cpp_run", "cpp_symbols",
    "cpp_test", "cpp_types",
  ]);
  for (const event of ["session_start", "session_shutdown", "session_compact", "before_agent_start", "tool_result"]) {
    assert.ok(events.includes(event), event);
  }
  assert.ok(commands.includes("cpp-setup"));
  assert.ok(commands.includes("cpp-preset"));
});

/** Runs /cpp-setup against canned tool versions; a tool missing from `versions` is not installed. */
const mockClangd = resolve("tests/fixtures/mock-clangd.mjs");
/** The feature probes use the mock clangd, so /cpp-setup tests never start a real one. */
const mockToolchain = (...features: string[]) => ({ clangd: { command: process.execPath, args: [mockClangd, `--mock-features=${features.join(",")}`], timeoutMs: 2000 }, clangdTimeoutMs: 2000 });

async function cppSetup(versions: Record<string, string>, options: ExtensionOptions = { toolchain: mockToolchain() }): Promise<string> {
  const commands = new Map<string, any>();
  const notes: string[] = [];
  const exec = async (command: string, args: string[]) => {
    // Tools are probed as `sh -c "<tool> --version"`, cmake as `cmake --version`.
    const tool = command === "sh" ? args[1].split(" ")[0] : command;
    const stdout = versions[tool];
    return stdout === undefined ? { code: 127, stdout: "", stderr: "not found", killed: false } : { code: 0, stdout, stderr: "", killed: false };
  };
  extension({
    registerTool() {}, on() {}, exec,
    registerCommand(name: string, command: any) { commands.set(name, command); },
  } as unknown as ExtensionAPI, options);
  await commands.get("cpp-setup").handler("", { ui: { notify: (message: string) => notes.push(message) } });
  return notes.join("\n");
}

test("/cpp-setup lists ninja, the clangd features its version supports and the CMake thresholds", async () => {
  const report = await cppSetup({
    clangd: "Ubuntu clangd version 18.1.3 (1ubuntu1)\nFeatures: linux+grpc\n",
    cmake: "cmake version 3.16.3\n\nCMake suite maintained and supported by Kitware (kitware.com/cmake).\n",
  });
  assert.match(report, /✓ clangd: Ubuntu clangd version 18\.1\.3/);
  assert.match(report, /✓ type hierarchy/);
  assert.match(report, /✗ outgoing calls: needs clangd 21 or newer/);
  assert.match(report, /✓ cmake: 3\.16\.3/);
  assert.match(report, /✓ project model/);
  assert.match(report, /✗ presets: need CMake 3\.19 or newer/);
  assert.match(report, /✗ ninja: not found/);
});

test("/cpp-setup reports a CMake too old for the project model and a clangd with every navigation feature", async () => {
  const report = await cppSetup({
    clangd: "clangd version 21.1.8\n",
    cmake: "cmake version 3.10.2\n",
    ninja: "1.12.1\n",
  });
  assert.match(report, /✓ outgoing calls/);
  assert.match(report, /✗ project model: needs CMake 3\.14 or newer/);
  assert.match(report, /✓ ninja: 1\.12\.1/);
});

test("/cpp-setup compares the default compiler's and clangd's C++ features", async () => {
  const report = await cppSetup({ clangd: "clangd version 21.1.8\n" }, { toolchain: mockToolchain("pack_indexing") });
  // The fake exec answers `sh -c 'command -v ...'` with 127, so c++ counts as not on PATH.
  assert.match(report, /✗ C\+\+ compiler: c\+\+ was not found on PATH/);
  assert.match(report, /C\+\+26: clangd: pack indexing/);
});
