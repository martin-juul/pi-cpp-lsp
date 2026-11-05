import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { ExecOptions, ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProjectService } from "../packages/core/src/project/session.ts";
import type { ProjectModel } from "../packages/core/src/project/model.ts";
import type { Exec } from "../packages/core/src/project/configure.ts";
import { registerClangdTools, registerRenameTool, type ClangdToolOptions, type RenameToolOptions } from "../extensions/register.ts";

const mock = resolve("tests/fixtures/mock-clangd.mjs");

// A child_process executor with pi.exec's contract: no shell, kill on abort or timeout.
const nodeExec: Exec = (command: string, args: string[], options: ExecOptions = {}) => new Promise<ExecResult>(done => {
  let stdout = "", stderr = "", killed = false;
  const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
  const kill = () => { killed = true; child.kill("SIGKILL"); };
  if (options.signal?.aborted) kill(); else options.signal?.addEventListener("abort", kill, { once: true });
  const timer = options.timeout ? setTimeout(kill, options.timeout) : undefined;
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  child.on("error", () => { clearTimeout(timer); done({ stdout, stderr, code: 127, killed }); });
  child.on("close", code => { clearTimeout(timer); done({ stdout, stderr, code: code ?? 1, killed }); });
});
/** pi.exec for a missing clang-format, so file contents stay exactly as the rename wrote them. */
const noClangFormat: Exec = (command, args, options) => command === "clang-format"
  ? Promise.resolve({ stdout: "", stderr: "clang-format: not found", code: 127, killed: false })
  : nodeExec(command, args, options);

type Project = NonNullable<ReturnType<NonNullable<ClangdToolOptions["getProject"]>>> & ReturnType<RenameToolOptions["getProject"]>;

/** cpp_rename beside the clangd tools on a fake ExtensionAPI, sharing one managed connection as index.ts wires them. */
function register(clangdOptions: ClangdToolOptions, getProject: () => Project | undefined, renameOptions: Partial<RenameToolOptions> = {}) {
  const tools = new Map<string, any>();
  const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
  const api = { registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]) };
  const managed = registerClangdTools(api as unknown as ExtensionAPI, { ...clangdOptions, getProject });
  registerRenameTool(api as unknown as ExtensionAPI, managed, { exec: noClangFormat, getProject, waitMs: 2000, firstOpenWaitMs: 4000, ...renameOptions });
  const emit = async (name: string, event: any = {}) => { for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, {}); };
  return { tools, managed, emit };
}

type Result = { text: string; isError: boolean; details: any };
function caller(tools: Map<string, any>, cwd: string) {
  return async (params: Record<string, unknown>): Promise<Result> => {
    const result = await tools.get("cpp_rename").execute("call", params, undefined, undefined, { cwd });
    return { text: result.content.map((part: any) => part.text).join(""), isError: result.isError === true, details: result.details };
  };
}

async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await new Promise(done => setTimeout(done, 10));
  }
}

async function contents(files: string[]): Promise<string[]> {
  return Promise.all(files.map(file => readFile(file, "utf8")));
}

const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

// ---------------------------------------------------------------------------
// Mock clangd: refusals, the write transaction and the documentChanges form

/**
 * A managed mock connection over a temp project whose main.cpp is `text`. `files` are written
 * relative to the project root first. The rename answers with the WorkspaceEdit `edit`.
 */
async function mockProject(t: any, text: string, files: Record<string, string>, edit: (root: string) => unknown, renameOptions: Partial<RenameToolOptions> = {}) {
  const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-rename-mock-")));
  const outside = realpathSync(await mkdtemp(join(tmpdir(), "pi-rename-outside-")));
  const buildDir = join(root, "managed");
  await mkdir(buildDir);
  await writeFile(join(buildDir, "compile_commands.json"), "[]");
  for (const [name, content] of Object.entries(files)) {
    const path = name.startsWith("/") ? name.replace("/OUTSIDE", outside) : join(root, name);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
  const editFile = join(outside, "edit.json");
  await writeFile(editFile, JSON.stringify(edit(root)).replaceAll("/OUTSIDE", outside));
  const source = join(root, "main.cpp");
  await writeFile(source, `${text.replaceAll("ROOT", root)}\nRENAME-EDIT ${editFile}\n`);
  const model = { sourceRoot: root, buildDir, targets: [{ isProjectTarget: true, sources: [{ path: source, isGenerated: false, language: "CXX" }] }] } as unknown as ProjectModel;
  const project = { model, onModelChange: () => () => {}, reportPoint: async () => undefined, ownerOf: () => undefined } as unknown as Project;
  const registered = register({ command: process.execPath, args: [mock], timeoutMs: 2000 }, () => project, renameOptions);
  t.after(async () => {
    await registered.emit("session_shutdown");
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await registered.emit("session_start");
  return { root, outside, source, call: caller(registered.tools, root), managed: registered.managed };
}

const uri = (path: string) => pathToFileURL(path).href;

test("indexing that does not finish within the wait refuses the rename and changes nothing", async t => {
  const h = await mockProject(t, "INDEX-BEGIN", { "a.cpp": "int name();\n" }, root => ({
    changes: { [uri(join(root, "a.cpp"))]: [{ range: range(0, 4, 8), newText: "other" }] },
  }), { indexWaitMs: 300 });
  const connection = (await h.managed.connection())!;
  await until(() => connection.indexState === "indexing");
  const before = await contents([join(h.root, "a.cpp"), h.source]);
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "other" });
  assert.equal(result.isError, true, result.text);
  assert.match(result.text, /retry after indexing completes/);
  assert.match(result.text, /No files were changed/);
  assert.deepEqual(await contents([join(h.root, "a.cpp"), h.source]), before);
});

test("edits outside the source root, under _deps or in the managed build directory refuse, name the path and change nothing", async t => {
  for (const [label, target] of [["outside", "/OUTSIDE/system.h"], ["_deps", "_deps/lib/dep.h"], ["managed", "managed/gen.h"]] as const) {
    await t.test(label, async t => {
      const h = await mockProject(t, "INDEX-END", { "a.cpp": "int name();\n", [target]: "int name();\n" }, root => ({
        changes: {
          [uri(join(root, "a.cpp"))]: [{ range: range(0, 4, 8), newText: "other" }],
          [uri(target.startsWith("/") ? target : join(root, target))]: [{ range: range(0, 4, 8), newText: "other" }],
        },
      }));
      const targetPath = target.startsWith("/") ? target.replace("/OUTSIDE", h.outside) : join(h.root, target);
      const files = [join(h.root, "a.cpp"), targetPath, h.source];
      const before = await contents(files);
      const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "other" });
      assert.equal(result.isError, true, result.text);
      assert.ok(result.text.includes(targetPath), result.text);
      assert.match(result.text, /No files were changed/);
      assert.deepEqual(await contents(files), before);
    });
  }
});

test("a file that changed on disk after clangd synced it refuses with file changed during rename", async t => {
  const h = await mockProject(t, "INDEX-END\nRENAME-TOUCH ROOT/main.cpp", { "a.cpp": "int name();\n" }, root => ({
    changes: {
      [uri(join(root, "a.cpp"))]: [{ range: range(0, 4, 8), newText: "other" }],
      [uri(join(root, "main.cpp"))]: [{ range: range(0, 0, 5), newText: "other" }],
    },
  }));
  const a = await readFile(join(h.root, "a.cpp"), "utf8");
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "other" });
  assert.equal(result.isError, true, result.text);
  assert.match(result.text, /file changed during rename/);
  assert.ok(result.text.includes(h.source), result.text);
  assert.equal(await readFile(join(h.root, "a.cpp"), "utf8"), a);
  // Only the simulated outside change is on disk, not the rename.
  assert.match(await readFile(h.source, "utf8"), /^INDEX-END\n.*\n\/\/ changed on disk\n$/s);
});

test("a write failure on the third file restores the files already written", async t => {
  const names = ["a.cpp", "b.cpp", "c.cpp", "d.cpp"];
  let failed = false;
  const h = await mockProject(t, "INDEX-END", Object.fromEntries(names.map(name => [name, `int name(); // ${name}\n`])), root => ({
    changes: Object.fromEntries(names.map(name => [uri(join(root, name)), [{ range: range(0, 4, 8), newText: "other" }]])),
  }), {
    write: async (file, text) => {
      if (file.endsWith("c.cpp") && !failed) { failed = true; throw new Error("disk full"); }
      await writeFile(file, text);
    },
  });
  const files = names.map(name => join(h.root, name));
  const before = await contents(files);
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "other" });
  assert.equal(failed, true);
  assert.equal(result.isError, true, result.text);
  assert.match(result.text, /disk full/);
  assert.ok(result.text.includes(files[2]!), result.text);
  assert.match(result.text, /No files were changed/);
  assert.deepEqual(await contents(files), before);
});

test("a write failure whose restore also fails lists exactly the files left renamed", async t => {
  const names = ["a.cpp", "b.cpp", "c.cpp", "d.cpp"];
  const original = (name: string) => `int name(); // ${name}\n`;
  const h = await mockProject(t, "INDEX-END", Object.fromEntries(names.map(name => [name, original(name)])), root => ({
    changes: Object.fromEntries(names.map(name => [uri(join(root, name)), [{ range: range(0, 4, 8), newText: "other" }]])),
  }), {
    write: async (file, text) => {
      if (file.endsWith("c.cpp")) throw new Error("disk full");
      if (file.endsWith("a.cpp") && text === original("a.cpp")) throw new Error("read-only now");
      await writeFile(file, text);
    },
  });
  const files = names.map(name => join(h.root, name));
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "other" });
  assert.equal(result.isError, true, result.text);
  assert.match(result.text, /disk full/);
  assert.match(result.text, /could not be restored/);
  assert.equal(result.details.refused, false);
  assert.deepEqual(result.details.unrestored, [files[0]]);
  assert.ok(result.text.includes(files[0]!), result.text);
  assert.ok(!result.text.includes(files[1]!), "a restored file is not listed");
  assert.deepEqual(await contents(files), ["int other(); // a.cpp\n", original("b.cpp"), original("c.cpp"), original("d.cpp")]);
});

test("prepareRename refusal is returned and nothing changes", async t => {
  const h = await mockProject(t, "INDEX-END\nNO-RENAME", { "a.cpp": "int name();\n" }, root => ({
    changes: { [uri(join(root, "a.cpp"))]: [{ range: range(0, 4, 8), newText: "other" }] },
  }));
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "other" });
  assert.equal(result.isError, true, result.text);
  assert.match(result.text, /Cannot rename symbol: there is no symbol at the given location/);
  assert.equal(await readFile(join(h.root, "a.cpp"), "utf8"), "int name();\n");
});

test("a documentChanges edit applies every edit in UTF-16 positions, in reverse order", async t => {
  // "😀" is two UTF-16 code units; both edits on line 1 must land on the identifiers.
  const h = await mockProject(t, "INDEX-END", { "a.cpp": "int name();\n/*😀*/ int x = name() + name();\n", "b.h": "int name();\r\nint y;\r\n" }, root => ({
    documentChanges: [
      { textDocument: { uri: uri(join(root, "a.cpp")), version: null }, edits: [{ range: range(1, 24, 28), newText: "total" }, { range: range(0, 4, 8), newText: "total" }] },
      { textDocument: { uri: uri(join(root, "b.h")), version: null }, edits: [{ range: range(0, 4, 8), newText: "total" }] },
      { textDocument: { uri: uri(join(root, "a.cpp")), version: null }, edits: [{ range: range(1, 15, 19), newText: "total" }] },
    ],
  }));
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "total" });
  assert.equal(result.isError, false, result.text);
  assert.equal(await readFile(join(h.root, "a.cpp"), "utf8"), "int total();\n/*😀*/ int x = total() + total();\n");
  assert.equal(await readFile(join(h.root, "b.h"), "utf8"), "int total();\r\nint y;\r\n");
  assert.deepEqual(result.details.changed.map((entry: any) => entry.file).sort(), [join(h.root, "a.cpp"), join(h.root, "b.h")]);
  assert.ok(result.text.includes("a.cpp") && result.text.includes("b.h"), result.text);
});

test("without a managed project the tool explains that the CMake model is needed", async t => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-rename-none-"));
  await writeFile(join(cwd, "main.cpp"), "int x;\n");
  const registered = register({ command: process.execPath, args: [mock], timeoutMs: 1000 }, () => undefined);
  t.after(async () => { await registered.emit("session_shutdown"); await rm(cwd, { recursive: true, force: true }); });
  await registered.emit("session_start");
  const result = await caller(registered.tools, cwd)({ file: "main.cpp", line: 1, column: 5, new_name: "y" });
  assert.equal(result.isError, true);
  assert.match(result.text, /CMake project model/);
});

// ---------------------------------------------------------------------------
// Real clangd

const clangdAvailable = spawnSync("clangd", ["--version"], { encoding: "utf8" }).status === 0;
const cmakeAvailable = spawnSync("cmake", ["--version"]).status === 0;

/** A real ProjectService and managed clangd over a temp copy of `setup`, with a temp XDG cache, ready and indexed. */
function realProject(name: string, setup: (root: string) => Promise<void> | void, exec: Exec) {
  const state = { root: "", scratch: "", call: undefined as unknown as ReturnType<typeof caller> };
  let previousCache: string | undefined;
  let project: ProjectService | undefined;
  let registered: ReturnType<typeof register> | undefined;
  before(async () => {
    previousCache = process.env.XDG_CACHE_HOME;
    state.scratch = realpathSync(await mkdtemp(join(tmpdir(), `pi-rename-${name}-`)));
    process.env.XDG_CACHE_HOME = join(state.scratch, "cache");
    state.root = join(state.scratch, name);
    await mkdir(state.root);
    await setup(state.root);
    const service = new ProjectService({ cwd: state.root, exec: nodeExec });
    project = service;
    registered = register({ timeoutMs: 60_000 }, () => service, { exec });
    state.call = caller(registered.tools, state.root);
    await registered.emit("session_start");
    await until(() => service.status === "ready", 60_000);
    const connection = (await registered.managed.connection())!;
    assert.equal(await connection.waitForIndexIdle(60_000), "idle");
  });
  after(async () => {
    await registered?.emit("session_shutdown");
    project?.dispose();
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previousCache;
    await rm(state.scratch, { recursive: true, force: true });
  });
  return state;
}

function build(source: string, buildDir: string) {
  for (const args of [["-S", source, "-B", buildDir], ["--build", buildDir]]) {
    const run = spawnSync("cmake", args, { encoding: "utf8" });
    assert.equal(run.status, 0, `cmake ${args.join(" ")}\n${run.stdout}\n${run.stderr}`);
  }
}

describe("real clangd rename on the nav fixture", { skip: !(clangdAvailable && cmakeAvailable) }, () => {
  const h = realProject("nav", root => cpSync(resolve("tests/fixtures/cmake/nav"), root, { recursive: true }), nodeExec);
  const files = ["shared.h", "shared.cpp", "alpha.cpp", "beta.cpp", "gamma.cpp", "main.cpp", "shapes.cpp"];

  test("prepareRename on a keyword returns clangd's refusal and nothing changes", async () => {
    const before = await contents(files.map(file => join(h.root, file)));
    const result = await h.call({ file: "shared.h", line: 3, column: 1, new_name: "other" });
    assert.equal(result.isError, true, result.text);
    assert.match(result.text, /clangd/);
    assert.match(result.text, /No files were changed/);
    assert.deepEqual(await contents(files.map(file => join(h.root, file))), before);
  });

  test("an invalid identifier returns clangd's error and nothing changes", async () => {
    const before = await contents(files.map(file => join(h.root, file)));
    const result = await h.call({ file: "shared.h", line: 3, column: 5, new_name: "1bad name" });
    assert.equal(result.isError, true, result.text);
    assert.match(result.text, /clangd: .*invalid/i);
    assert.deepEqual(await contents(files.map(file => join(h.root, file))), before);
  });

  test("renaming the shared function updates the header, the definition and the three callers, and the project builds", async () => {
    const result = await h.call({ file: "shared.h", line: 3, column: 5, new_name: "combined_total" });
    assert.equal(result.isError, false, result.text);
    const changed = ["shared.h", "shared.cpp", "alpha.cpp", "beta.cpp", "gamma.cpp"];
    assert.deepEqual(result.details.changed.map((entry: any) => entry.file).sort(), changed.map(file => join(h.root, file)).sort());
    for (const file of changed) {
      const text = await readFile(join(h.root, file), "utf8");
      assert.match(text, /\bcombined_total\(/, file);
      assert.doesNotMatch(text, /shared_total/, file);
      assert.ok(result.text.includes(file), `${file} listed in\n${result.text}`);
    }
    assert.equal(result.text.match(/diagnostics: no problems/g)?.length, changed.length, result.text);
    build(h.root, join(h.scratch, "build"));
  });
});

describe("real clangd rename across more than 50 files", { skip: !(clangdAvailable && cmakeAvailable) }, () => {
  const callers = 60;
  const h = realProject("wide", async root => {
    const names = Array.from({ length: callers }, (_, index) => `caller_${index}.cpp`);
    await writeFile(join(root, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.14)\nproject(wide LANGUAGES CXX)\nadd_library(wide STATIC widely.cpp ${names.join(" ")})\n`);
    await writeFile(join(root, "widely.h"), "#pragma once\nint widely_used(int value);\n");
    await writeFile(join(root, "widely.cpp"), "#include \"widely.h\"\nint widely_used(int value) { return value; }\n");
    for (const [index, name] of names.entries()) await writeFile(join(root, name), `#include "widely.h"\nint caller_${index}() { return widely_used(${index}); }\n`);
  }, noClangFormat);

  test("the rename file limit is lifted, so every file is renamed", async () => {
    const result = await h.call({ file: "widely.h", line: 2, column: 5, new_name: "broadly_used" });
    assert.equal(result.isError, false, result.text);
    assert.equal(result.details.changed.length, callers + 2);
    assert.match(await readFile(join(h.root, "caller_59.cpp"), "utf8"), /return broadly_used\(59\)/);
    assert.match(await readFile(join(h.root, "widely.h"), "utf8"), /int broadly_used\(int value\);/);
  });
});

// ---------------------------------------------------------------------------
// Build check after a rename in projects whose build compiler supports features clangd lacks

type TargetSpec = { name: string; gap?: boolean; dependencies?: string[]; sources: Record<string, string> };

/**
 * A mock-clangd project with named targets, a compilation database and a toolchain whose gap targets
 * are the specs marked `gap`. The fake compiler answers each checked source with `output(file)`, after
 * `delayMs`; like pi.exec it is killed at its timeout.
 */
async function gapProject(t: any, specs: TargetSpec[], files: Record<string, string>, edit: (root: string) => unknown, options: { output?: (file: string) => string; delayMs?: number; renameCheckMs?: number } = {}) {
  const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-rename-gap-")));
  const buildDir = join(root, "managed");
  await mkdir(buildDir);
  const write = async (name: string, content: string) => {
    await mkdir(resolve(join(root, name), ".."), { recursive: true });
    await writeFile(join(root, name), content);
  };
  for (const [name, content] of Object.entries(files)) await write(name, content);
  const editFile = join(root, "managed", "edit.json");
  await writeFile(editFile, JSON.stringify(edit(root)));
  const source = join(root, "main.cpp");
  await writeFile(source, `INDEX-END\nRENAME-EDIT ${editFile}\n`);
  const entries: object[] = [{ directory: buildDir, file: source, arguments: ["g++", "-std=c++26", "-c", source] }];
  const targets = [];
  for (const spec of specs) {
    const sources = [];
    for (const [name, content] of Object.entries(spec.sources)) {
      await write(name, content);
      const path = join(root, name);
      entries.push({ directory: buildDir, file: path, arguments: ["g++", "-std=c++26", "-c", path] });
      sources.push({ path, isGenerated: false, language: "CXX", standard: "26", backtrace: [] });
    }
    targets.push({ name: spec.name, id: spec.name, type: "EXECUTABLE", kind: "executable", isProjectTarget: true, sourceDir: root, sources, cxxStandard: "26", includeDirs: [], defines: [], dependencies: spec.dependencies ?? [], artifacts: [], backtrace: [] });
  }
  await writeFile(join(buildDir, "compile_commands.json"), JSON.stringify(entries));
  const model = { sourceRoot: root, buildDir, targets } as unknown as ProjectModel;
  const project = { model, onModelChange: () => () => {}, reportPoint: async () => undefined, ownerOf: () => undefined } as unknown as Project;
  const profiles = specs.filter(spec => spec.gap).map(spec => ({
    target: spec.name, standard: 26 as const, compiler: "g++ 16", family: "gcc" as const, available: ["contracts"], needsFlag: {}, clangdLacks: ["contracts"], gap: true,
    entry: { file: join(root, Object.keys(spec.sources)[0]!), directory: buildDir, argv: ["g++", "-std=c++26", "-c", join(root, Object.keys(spec.sources)[0]!)] },
  }));
  const profileOf = new Map(specs.flatMap(spec => Object.keys(spec.sources).map(name => [join(root, name), profiles.find(profile => profile.target === spec.name)] as const)));
  const toolchain = { gapProfiles: profiles, gapProfileFor: (file: string) => profileOf.get(file) };
  const compiled: string[] = [];
  const exec: Exec = async (command, args, execOptions) => {
    if (command === "clang-format") return { stdout: "", stderr: "clang-format: not found", code: 127, killed: false };
    const file = args.find(arg => profileOf.has(arg) || arg === source)!;
    compiled.push(file);
    const delay = options.delayMs ?? 0;
    if (execOptions?.timeout !== undefined && execOptions.timeout < delay) {
      await new Promise(done => setTimeout(done, execOptions.timeout));
      return { stdout: "", stderr: "", code: 1, killed: true };
    }
    if (delay) await new Promise(done => setTimeout(done, delay));
    const stderr = options.output?.(file) ?? "";
    return { stdout: "", stderr, code: stderr.includes("error:") ? 1 : 0, killed: false };
  };
  const logged: string[] = [];
  const registered = register({ command: process.execPath, args: [mock], timeoutMs: 2000 }, () => project, { exec, toolchain, renameCheckMs: options.renameCheckMs, log: line => logged.push(line) });
  t.after(async () => {
    await registered.emit("session_shutdown");
    await rm(root, { recursive: true, force: true });
  });
  await registered.emit("session_start");
  return { root, compiled, logged, call: caller(registered.tools, root) };
}

const renameIn = (...names: string[]) => (root: string) => ({
  changes: Object.fromEntries(names.map(name => [uri(join(root, name)), [{ range: range(0, 4, 12), newText: "new_name" }]])),
});

test("a rename whose dependents in a gap target no longer compile stays applied and lists the errors", async t => {
  const h = await gapProject(t, [
    { name: "lib", sources: { "lib.cpp": "int old_name();\n" } },
    { name: "app", gap: true, dependencies: ["lib"], sources: { "widget.cpp": "int x = old_name(); // uses contracts clangd cannot parse\n" } },
  ], {}, renameIn("lib.cpp"), { output: file => file.endsWith("widget.cpp") ? `${file}:1:9: error: 'old_name' was not declared in this scope\n` : "" });
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "new_name" });
  assert.equal(result.isError, false, result.text);
  assert.match(await readFile(join(h.root, "lib.cpp"), "utf8"), /int new_name\(\);/);
  assert.match(result.text, /widget\.cpp:1:9: error: 'old_name' was not declared in this scope/);
  assert.match(result.text, /the build may be broken/);
  assert.ok(!h.compiled.some(file => file.endsWith("lib.cpp")), "lib is not a gap target, so it is not compiled");
});

test("changed files in a gap target show the compiler's verdict instead of clangd's errors, compiled once each", async t => {
  const h = await gapProject(t, [
    { name: "app", gap: true, sources: { "a.cpp": "int old_name(); // DIAG\n", "b.cpp": "int old_name(); // DIAG\n" } },
  ], {}, renameIn("a.cpp", "b.cpp"));
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "new_name" });
  assert.equal(result.isError, false, result.text);
  assert.doesNotMatch(result.text, /mock error/);
  assert.equal(result.text.match(/checked by g\+\+ 16$/gm)?.length, 2, result.text);
  assert.deepEqual(h.compiled.filter(file => /[ab]\.cpp$/.test(file)).sort(), [join(h.root, "a.cpp"), join(h.root, "b.cpp")]);
  assert.doesNotMatch(result.text, /the build may be broken/);
});

test("a dependent the compiler could not check is logged, and the check never claims no errors", async t => {
  const h = await gapProject(t, [
    { name: "lib", sources: { "lib.cpp": "int old_name();\n" } },
    { name: "app", gap: true, dependencies: ["lib"], sources: { "widget.cpp": "int x = old_name();\n" } },
  ], {}, renameIn("lib.cpp"), { output: file => file.endsWith("widget.cpp") ? "widget.cpp:1:9: internal compiler error: in tsubst, at cp/pt.cc:1\n" : "" });
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "new_name" });
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /1 file could not be checked; see the pi-cpp-lsp log/);
  assert.doesNotMatch(result.text, /no errors|internal compiler error/);
  assert.match(h.logged.join("\n"), /could not check .*widget\.cpp: widget\.cpp:1:9: internal compiler error/);
  assert.deepEqual(result.details.uncheckable.map((entry: { file: string }) => entry.file), [join(h.root, "widget.cpp")]);
});

test("a rename in a project without gap targets runs no compiler", async t => {
  const h = await gapProject(t, [{ name: "app", sources: { "a.cpp": "int old_name();\n" } }], {}, renameIn("a.cpp"));
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "new_name" });
  assert.equal(result.isError, false, result.text);
  assert.deepEqual(h.compiled, []);
});

test("a check that runs out of time says so and logs the targets it did not reach", async t => {
  const h = await gapProject(t, [
    { name: "app", gap: true, sources: { "a.cpp": "int old_name(); // DIAG\n" } },
  ], {}, renameIn("a.cpp"), { delayMs: 500, renameCheckMs: 100 });
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "new_name" });
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /not every file was checked within 0\.1s; see the pi-cpp-lsp log/);
  assert.match(h.logged.join("\n"), /not checked within 0\.1s: app/);
  // The changed file keeps clangd's errors; why the compiler did not judge it is in the log.
  assert.match(result.text, /mock error/);
  assert.doesNotMatch(result.text, /warning: clangd lacks/);
  assert.match(h.logged.join("\n"), /a\.cpp: g\+\+ 16 could not check it/);
});

test("a changed header no target lists makes every gap target part of the check", async t => {
  const h = await gapProject(t, [
    { name: "app", gap: true, sources: { "app.cpp": "#include \"api.h\"\n" } },
    { name: "tool", gap: true, sources: { "tool.cpp": "#include \"api.h\"\n" } },
    { name: "clean", sources: { "clean.cpp": "int y;\n" } },
  ], { "api.h": "int old_name();\n" }, renameIn("api.h"));
  const result = await h.call({ file: "main.cpp", line: 1, column: 1, new_name: "new_name" });
  assert.equal(result.isError, false, result.text);
  assert.ok(h.compiled.includes(join(h.root, "app.cpp")) && h.compiled.includes(join(h.root, "tool.cpp")), h.compiled.join(","));
  assert.ok(!h.compiled.includes(join(h.root, "clean.cpp")));
});
