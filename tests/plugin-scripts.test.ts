import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/index.ts";
import { setupReport } from "../plugins/cpp-lsp/src/bin/setup.ts";

// The feature probes stay private to this file, so test files running at the same time never count them.
process.env.TMPDIR = mkdtempSync(join(tmpdir(), "cpp-lsp-scripts-tmp-"));

const trustSource = resolve("plugins/cpp-lsp/src/bin/trust.ts");
const trustBundle = resolve("plugins/cpp-lsp/server/trust.mjs");
const setupBundle = resolve("plugins/cpp-lsp/server/setup.mjs");

/** Runs a script as the skill does; the environment carries no Claude Code variables unless given. */
function run(script: string, args: string[], env: Record<string, string> = {}) {
  const base = { ...process.env };
  delete base.CLAUDE_PROJECT_DIR;
  delete base.CLAUDE_PLUGIN_DATA;
  const node = script.endsWith(".ts") ? ["--experimental-strip-types", "--no-warnings", script] : [script];
  const result = spawnSync(process.execPath, [...node, ...args], { encoding: "utf8", env: { ...base, ...env }, timeout: 120_000 });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

/** A CMake project with a subdirectory that has its own CMakeLists.txt. */
function cmakeProject(): { root: string; sub: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cpp-lsp-trust-")));
  const sub = join(root, "core");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(root, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.14)\nproject(trust CXX)\nadd_subdirectory(core)\n");
  writeFileSync(join(sub, "CMakeLists.txt"), "add_library(core core.cpp)\n");
  return { root, sub };
}

const dataDir = () => join(mkdtempSync(join(tmpdir(), "cpp-lsp-trust-data-")), "data");
const trusted = (data: string) => JSON.parse(readFileSync(join(data, "trusted.json"), "utf8"));

for (const [label, script] of [["source", trustSource], ["bundle", trustBundle]] as const) {
  test(`the trust script (${label}) enables the real source root from a subdirectory, once`, () => {
    const { root, sub } = cmakeProject();
    const data = dataDir();
    const first = run(script, [sub, data]);
    assert.equal(first.status, 0);
    assert.equal(first.stdout, `cpp-lsp is now enabled for ${root}. It configures the project with CMake in its own cache, and the next prompt carries the project briefing. New sessions in this project start enabled.`);
    assert.deepEqual(trusted(data), [root]);

    const second = run(script, [root, data]);
    assert.equal(second.status, 0);
    assert.equal(second.stdout, `cpp-lsp is already enabled for ${root}.`);
    assert.deepEqual(trusted(data), [root]);
  });
}

test("the trust script reads the project and data directories from Claude Code's environment when not given", () => {
  const { root } = cmakeProject();
  const data = dataDir();
  const result = run(trustSource, [], { CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_DATA: data });
  assert.equal(result.status, 0);
  assert.deepEqual(trusted(data), [root]);
});

test("outside a CMake project the trust script says so and writes nothing", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cpp-lsp-plain-")));
  const data = dataDir();
  const result = run(trustSource, [dir, data]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${dir} is not a CMake project: no CMakeLists.txt was found in it or its parent directories, so there is nothing for cpp-lsp to enable.`);
  assert.ok(!existsSync(data));
});

test("when the trust list cannot be written, or a directory is missing, the trust script reports it and still exits 0", () => {
  const { root } = cmakeProject();
  const blocker = join(mkdtempSync(join(tmpdir(), "cpp-lsp-trust-data-")), "file");
  writeFileSync(blocker, "");
  const unwritable = run(trustSource, [root, join(blocker, "data")]);
  assert.equal(unwritable.status, 0);
  assert.match(unwritable.stdout, new RegExp(`^cpp-lsp could not enable ${root}: writing .*trusted\\.json failed: `));

  const noData = run(trustSource, [root]);
  assert.equal(noData.status, 0);
  assert.equal(noData.stdout, `cpp-lsp could not enable ${root}: Claude Code passed no plugin data directory to remember it in.`);

  const noProject = run(trustSource, []);
  assert.equal(noProject.status, 0);
  assert.equal(noProject.stdout, "cpp-lsp could not tell which project to enable: Claude Code passed no project directory.");
});

const mockClangd = resolve("tests/fixtures/mock-clangd.mjs");
const toolchain = { clangd: { command: process.execPath, args: [mockClangd, "--mock-features=pack_indexing"], timeoutMs: 2000 }, clangdTimeoutMs: 2000 };

test("the setup report has the lines pi's /cpp-setup shows for the same toolchain, naming the plugin's preset command", async () => {
  const versions: Record<string, string> = {
    clangd: "clangd version 21.1.8\n",
    "clang-format": "clang-format version 21.1.8\n",
    cmake: "cmake version 3.28.3\n\nCMake suite maintained and supported by Kitware (kitware.com/cmake).\n",
    ninja: "1.12.1\n",
  };
  const exec = async (command: string, args: string[]) => {
    // Tools are probed as `sh -c "<tool> --version"`, cmake as `cmake --version`.
    const tool = command === "sh" ? args[1]!.split(" ")[0]! : command;
    const stdout = versions[tool];
    return stdout === undefined ? { code: 127, stdout: "", stderr: "not found", killed: false } : { code: 0, stdout, stderr: "", killed: false };
  };
  // pi's report first: the plugin's wording, once set, holds for the whole process.
  const notes: string[] = [];
  const commands = new Map<string, any>();
  extension({
    registerTool() {}, on() {}, exec,
    registerCommand(name: string, command: any) { commands.set(name, command); },
  } as unknown as ExtensionAPI, { toolchain });
  await commands.get("cpp-setup").handler("", { ui: { notify: (message: string) => notes.push(message) } });
  const pi = notes.join("\n").split("\n");

  const plugin = (await setupReport(exec, toolchain)).split("\n");
  assert.ok(pi.includes("  ✓ presets (/cpp-preset)"));
  assert.deepEqual(plugin, pi.map(line => line === "  ✓ presets (/cpp-preset)" ? "  ✓ presets (/cpp-lsp:cpp-preset)" : line));
  assert.ok(plugin.includes("✓ clangd: clangd version 21.1.8"));
  assert.ok(plugin.includes("✗ cppcheck: not found — install with: brew install cppcheck"));
});

test("the bundled setup script prints a report for the real toolchain and exits 0", () => {
  const result = run(setupBundle, []);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^[✓✗] clangd: /);
  assert.match(result.stdout, /\n[✓✗] cmake: /);
});
