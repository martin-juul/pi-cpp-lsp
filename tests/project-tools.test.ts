import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExecOptions, ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Exec } from "../packages/core/src/project/configure.ts";
import { readProjectState } from "../packages/core/src/project/root.ts";
import { ProjectService } from "../packages/core/src/project/session.ts";
import { registerProjectTools } from "../extensions/register.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "cmake");
const hasCmake = spawnSync("cmake", ["--version"]).status === 0;

// A child_process executor with pi.exec's contract: no shell, kill on abort or timeout.
const nodeExec: Exec = (command: string, args: string[], options: ExecOptions = {}) => new Promise<ExecResult>(resolve => {
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

function freshCache(): void {
  process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "pi-cpp-cache-"));
}

function copyFixture(name: string): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-tools-"))), name);
  cpSync(join(fixtures, name), root, { recursive: true });
  return root;
}

interface ToolText { text: string; isError: boolean }

/** registerProjectTools on a fake pi, driven through the registered tool and command. */
function harness(t: any, root: string, options: { exec?: Exec; project?: ProjectService | null } = {}) {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const notifications: { message: string; level?: string }[] = [];
  const project = options.project === null ? undefined : options.project ?? new ProjectService({ cwd: root, exec: options.exec ?? nodeExec });
  if (project) t.after(() => project.dispose());
  const api = {
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
  };
  registerProjectTools(api as unknown as ExtensionAPI, () => project);
  const ctx = { cwd: root, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } };
  return {
    project: project!, tools, commands, notifications,
    async call(params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolText> {
      const result = await tools.get("cpp_project").execute("call", params, signal, undefined, ctx);
      return { text: result.content.map((part: any) => part.text).join(""), isError: result.isError === true };
    },
    async preset(args = "") {
      notifications.length = 0;
      await commands.get("cpp-preset").handler(args, ctx);
      return notifications.map(note => note.message).join("\n");
    },
  };
}

/** Wait until the service has no configure in flight. */
async function settled(project: ProjectService, timeoutMs = 120_000): Promise<void> {
  await project.ready();
  const deadline = Date.now() + timeoutMs;
  while (project.status === "configuring") {
    if (Date.now() > deadline) throw new Error("configure did not finish");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test("cpp_project answers overview, targets, target and owner on the multi fixture", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("multi");
  const h = harness(t, root);
  await settled(h.project);
  assert.equal(h.project.status, "ready");

  const overview = await h.call({ action: "overview" });
  assert.equal(overview.isError, false);
  assert.match(overview.text, /\| legacy \| library \| libs\/legacy \| C\+\+14 \|/);

  const targets = await h.call({ action: "targets" });
  assert.equal(targets.isError, false);
  assert.match(targets.text, /legacy.*library.*C\+\+14/);
  assert.match(targets.text, /app.*executable.*C\+\+20.*legacy/);
  assert.match(targets.text, /unit_tests.*test/);

  const legacy = await h.call({ action: "target", name: "legacy" });
  assert.equal(legacy.isError, false);
  assert.match(legacy.text, /C\+\+14/);
  assert.match(legacy.text, /libs\/legacy\/legacy\.cpp/);
  assert.match(legacy.text, /libs\/legacy\/extra\.cpp/);
  assert.match(legacy.text, /generated\.cpp.*generated/);
  assert.match(legacy.text, /libs\/legacy\/include/);
  assert.match(legacy.text, /LEGACY_API=1/);
  const app = await h.call({ action: "target", name: "app" });
  assert.match(app.text, /Depends on: legacy/);

  // AE8: the C++14 target's file, and a file shared with the C++20 target, must stay C++14.
  const own = await h.call({ action: "owner", path: "libs/legacy/legacy.cpp" });
  assert.equal(own.isError, false);
  assert.match(own.text, /built by: legacy \(C\+\+14\)$/m);
  assert.match(own.text, /Must stay valid for: C\+\+14/);
  const shared = await h.call({ action: "owner", path: join(root, "libs/legacy/shared.cpp") });
  assert.match(shared.text, /app \(C\+\+20\)/);
  assert.match(shared.text, /legacy \(C\+\+14\)/);
  assert.match(shared.text, /Must stay valid for: C\+\+14 \(the most restrictive/);

  const stray = await h.call({ action: "owner", path: "notes.txt" });
  assert.match(stray.text, /no project target/i);
});

test("cpp_project owner of a C source in a mixed target does not report its C standard as C++", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("mixed-c");
  const h = harness(t, root);
  await settled(h.project);
  assert.equal(h.project.status, "ready");

  const c = await h.call({ action: "owner", path: "legacy.c" });
  assert.equal(c.isError, false);
  assert.match(c.text, /built by: app \(C\+\+17\)$/m);
  assert.match(c.text, /Must stay valid for: compiler default/);
  assert.doesNotMatch(c.text, /C\+\+11/);
  const cpp = await h.call({ action: "owner", path: "main.cpp" });
  assert.match(cpp.text, /Must stay valid for: C\+\+17/);
});

test("cpp_project target on an unknown name lists the valid names", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("multi");
  const h = harness(t, root);
  await settled(h.project);
  const result = await h.call({ action: "target", name: "nope" });
  assert.equal(result.isError, true);
  assert.match(result.text, /nope/);
  assert.match(result.text, /app, legacy, unit_tests/);
});

test("cpp_project refresh after a CMakeLists.txt change returns the updated targets", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("multi");
  const h = harness(t, root);
  await settled(h.project);
  assert.doesNotMatch((await h.call({ action: "targets" })).text, /extra_tool/);
  appendFileSync(join(root, "CMakeLists.txt"), "add_executable(extra_tool app/main.cpp)\n");
  const result = await h.call({ action: "refresh" });
  assert.equal(result.isError, false);
  assert.match(result.text, /configure succeeded/i);
  assert.match(result.text, /extra_tool.*executable/);
  assert.equal(h.project.status, "ready");
});

test("overview returns the full briefing when the session briefing is in summary form", { skip: !hasCmake }, async t => {
  freshCache();
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-tools-"))), "many");
  mkdirSync(root);
  const names = Array.from({ length: 60 }, (_, index) => `component_library_number_${index}`);
  writeFileSync(join(root, "lib.cpp"), "int f() { return 0; }\n");
  writeFileSync(join(root, "CMakeLists.txt"), [
    "cmake_minimum_required(VERSION 3.14)",
    "project(many LANGUAGES CXX)",
    ...names.map(name => `add_library(${name} STATIC lib.cpp)`),
  ].join("\n") + "\n");
  const h = harness(t, root);
  await settled(h.project);
  assert.match(h.project.briefing(), /too large to brief in full/);
  const overview = await h.call({ action: "overview" });
  assert.doesNotMatch(overview.text, /too large to brief in full/);
  for (const name of names) assert.match(overview.text, new RegExp(`\\| ${name} \\| library \\|`));
});

test("/cpp-preset lists presets, switches to release and the next service uses it (AE7)", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("presets");
  const h = harness(t, root);
  await settled(h.project);
  assert.equal(h.project.lastConfigure?.preset, "debug");

  const listed = await h.preset();
  assert.match(listed, /debug.*active/);
  assert.match(listed, /release/);
  assert.doesNotMatch(listed, /release.*active/);
  assert.doesNotMatch(listed, /\bbase\b/);

  const targets = await h.call({ action: "targets" });
  assert.match(targets.text, /app.*executable/);

  const switched = await h.preset("release");
  assert.match(switched, /release/);
  assert.equal(readProjectState(root).preset, "release");
  assert.equal(h.project.lastConfigure?.preset, "release");
  assert.equal(h.project.status, "ready");
  assert.match(await h.preset(), /release.*active/);

  const next = new ProjectService({ cwd: root, exec: nodeExec });
  t.after(() => next.dispose());
  await settled(next);
  assert.equal(next.lastConfigure?.preset, "release");
  assert.match(next.briefing(), /Preset: release/);
});

test("cpp_project presets lists the presets, the active and default one, and leaves switching to /cpp-preset", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("presets");
  const h = harness(t, root);
  await settled(h.project);
  const result = await h.call({ action: "presets" });
  assert.equal(result.isError, false);
  assert.match(result.text, /^\s+release$/m);
  assert.match(result.text, /^\s+debug \(active, default\)$/m);
  assert.doesNotMatch(result.text, /\bbase\b/);
  assert.match(result.text, /\/cpp-preset <name>/);
  assert.deepEqual(readProjectState(root), {});
  assert.equal(h.project.lastConfigure?.preset, "debug");

  const plain = harness(t, copyFixture("basic"));
  await settled(plain.project);
  assert.match((await plain.call({ action: "presets" })).text, /no usable configure presets/);
});

test("/cpp-preset with an unknown name reports the available presets and changes nothing", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("presets");
  const h = harness(t, root);
  await settled(h.project);
  const before = h.project.lastConfigure;
  const text = await h.preset("nope");
  assert.match(text, /nope/);
  assert.match(text, /debug/);
  assert.match(text, /release/);
  assert.deepEqual(readProjectState(root), {});
  assert.equal(h.project.lastConfigure, before);
  assert.equal(h.project.status, "ready");
});

test("while configuring, every cpp_project action returns the loading state", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("multi");
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const exec: Exec = async (command, args, options = {}) => {
    if (command === "cmake" && args[0] === "-S") await gate;
    return nodeExec(command, args, options);
  };
  const h = harness(t, root, { exec });
  t.after(() => release());
  await h.project.ready();
  assert.equal(h.project.status, "configuring");
  const calls: Record<string, unknown>[] = [
    { action: "overview" }, { action: "targets" }, { action: "target", name: "legacy" },
    { action: "owner", path: "libs/legacy/legacy.cpp" }, { action: "refresh" },
  ];
  for (const params of calls) {
    const result = await h.call(params);
    assert.match(result.text, /still loading/, JSON.stringify(params));
    assert.match(result.text, /configure is running/, JSON.stringify(params));
  }
  release();
  await settled(h.project);
  assert.match((await h.call({ action: "targets" })).text, /legacy/);
});

test("cpp_project and /cpp-preset report a non-CMake directory", async t => {
  freshCache();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-tools-plain-")));
  for (const project of [new ProjectService({ cwd: root, exec: nodeExec }), null]) {
    const h = harness(t, root, { project });
    for (const action of ["overview", "targets", "refresh", "presets"]) {
      const result = await h.call({ action });
      assert.equal(result.isError, true);
      assert.match(result.text, /not a CMake project/);
    }
    assert.match(await h.preset(), /not a CMake project/);
  }
});
