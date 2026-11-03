import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, realpathSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import type { ExecOptions, ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProjectService } from "../extensions/lib/project/session.ts";
import type { ProjectModel } from "../extensions/lib/project/model.ts";
import { pathToFileURL } from "node:url";
import { ClangdConnection, ClangdUnsupportedError, registerClangdTools, type ClangdOptions, type ClangdToolOptions } from "../extensions/lib/clangd.ts";

const fixture = resolve("tests/fixtures/mock-clangd.mjs");
/** Registers the clangd tools on a fake ExtensionAPI that keeps every event handler. */
function register(options: ClangdToolOptions) {
  const tools = new Map<string, any>();
  const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
  const api = { registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]) };
  const managed = registerClangdTools(api as unknown as ExtensionAPI, options);
  const emit = async (name: string, event: any = {}) => { for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, {}); };
  return { tools, managed, emit };
}
async function harness(t: any, options: ClangdOptions = { command: process.execPath, args: [fixture], timeoutMs: 1000 }) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-clangd-test-"));
  const file = join(cwd, "hello world.cpp");
  await writeFile(file, "int value = 42;\nint main() { return value; }\n");
  const { tools, emit } = register(options);
  const shutdown = () => emit("session_shutdown");
  t.after(async () => { await shutdown(); await rm(cwd, { recursive: true, force: true }); });
  return { cwd, file, shutdown, call: (method = "hover", params: any = {}, signal?: AbortSignal) => tools.get(`cpp_${method}`).execute("call", { file, line: 1, column: 5, ...params }, signal, undefined, { cwd }) };
}

test("clangd initializes, frames responses, uses UTF-16 and refreshes disk contents", async t => {
  const h = await harness(t);
  await mkdir(join(h.cwd, "build dir"));
  await writeFile(join(h.cwd, "build dir", "compile_commands.json"), "[]");
  await writeFile(h.file, "// 😀 value\n");
  const first = await h.call("hover", { column: 7, build_dir: "build dir" });
  assert.equal(first.details.error, undefined);
  const data = JSON.parse(first.details.hover);
  assert.deepEqual(data.position, { line: 0, character: 6 });
  assert.equal(data.version, 1);
  assert.equal(data.buildDir, `--compile-commands-dir=${join(h.cwd, "build dir")}`);
  await writeFile(h.file, "// changed\n");
  const second = await h.call("hover", { build_dir: "build dir" });
  assert.equal(JSON.parse(second.details.hover).version, 2);
  assert.equal(JSON.parse(second.details.hover).text, "// changed\n");
  const other = await h.call();
  assert.equal(JSON.parse(other.details.hover).version, 1, "different compile database uses a different connection");
});

test("definition LocationLinks convert to paths and one-based selection ranges", async t => {
  const h = await harness(t);
  const result = await h.call("definition");
  assert.deepEqual(result.details.locations, [{ file: h.file, line: 2, column: 3, endLine: 2, endColumn: 6 }]);
  assert.match(result.content[0].text, /hello world.cpp:2:3/);
});

test("empty results, invalid positions, unreadable files and server errors are useful", async t => {
  const h = await harness(t);
  const invalid = await h.call("hover", { line: 999 });
  assert.equal(invalid.isError, true);
  assert.match(invalid.details.message, /outside the file/);
  assert.equal((await h.call("hover", { file: "missing.cpp" })).details.error, true);
  assert.match((await h.call("hover", { build_dir: "missing-build" })).details.message, /compile_commands.json/);
  await writeFile(h.file, "EMPTY");
  assert.equal((await h.call()).details.found, false);
  assert.deepEqual((await h.call("definition")).details.locations, []);
  await writeFile(h.file, "ERROR");
  assert.match((await h.call()).details.message, /mock failure/);
});

test("cancellation sends cancelRequest and leaves the connection usable", async t => {
  const h = await harness(t);
  await h.call(); // complete initialization first
  await writeFile(h.file, "HANG");
  const controller = new AbortController();
  const pending = h.call("hover", {}, controller.signal);
  setTimeout(() => controller.abort(), 60);
  assert.match((await pending).details.message, /cancelled/);
  await writeFile(h.file, "int okay;");
  const data = JSON.parse((await h.call()).details.hover);
  assert.equal(data.version, 3);
  assert.equal(data.cancellations.length, 1);
  controller.abort();
  assert.match((await h.call("hover", {}, controller.signal)).details.message, /cancelled/);
});

test("request timeouts and crashes restart on the next call", async t => {
  const h = await harness(t, { command: process.execPath, args: [fixture], timeoutMs: 150 });
  await writeFile(h.file, "HANG");
  assert.match((await h.call()).details.message, /timed out/);
  await writeFile(h.file, "int okay;");
  assert.equal((await h.call()).details.found, true);
  await writeFile(h.file, "CRASH");
  assert.match((await h.call()).details.message, /clangd (exited|closed)/);
  await writeFile(h.file, "int okay;");
  assert.equal((await h.call()).details.found, true);
});

test("missing binary and initialization timeout return errors and shutdown completes", async t => {
  const missing = await harness(t, { command: "/nonexistent/clangd" });
  const failure = await missing.call();
  assert.equal(failure.isError, true);
  assert.match(failure.details.message, /Install clangd/);
  const hanging = await harness(t, { command: process.execPath, args: [fixture, "init-hang"], timeoutMs: 100 });
  assert.match((await hanging.call()).details.message, /initialize timed out/);
  await hanging.shutdown();
});

test("hover output is bounded", async t => {
  const h = await harness(t);
  await writeFile(h.file, "x".repeat(50_000));
  const result = await h.call();
  assert.ok(result.content[0].text.length < 25_000);
  assert.match(result.content[0].text, /output truncated/);
});

const clangdAvailable = spawnSync("clangd", ["--version"], { encoding: "utf8" }).status === 0;
test("real clangd resolves symbol hover and definition and updates changed source", { skip: !clangdAvailable }, async t => {
  const h = await harness(t, { timeoutMs: 15_000 });
  const hover = await h.call("hover", { line: 2, column: 21 });
  assert.equal(hover.details.error, undefined, hover.content[0].text);
  assert.match(hover.details.hover, /value/);
  const definition = await h.call("definition", { line: 2, column: 21 });
  assert.equal(definition.details.locations[0].file, h.file);
  assert.equal(definition.details.locations[0].line, 1);
  await writeFile(h.file, "double changed = 1.0;\nint main() { return changed; }\n");
  const changed = await h.call("hover", { line: 2, column: 21 });
  assert.match(changed.details.hover, /double/);
  assert.match(changed.details.hover, /changed/);
});


test("real clangd refreshes a previously opened header before querying source", { skip: !clangdAvailable }, async t => {
  const h = await harness(t, { timeoutMs: 15_000 });
  const header = join(h.cwd, "value.h");
  await writeFile(header, "inline int value = 42;\n");
  await writeFile(h.file, '#include "value.h"\nint main() { return value; }\n');
  assert.equal((await h.call("hover", { file: header, line: 1, column: 12 })).details.error, undefined);
  assert.match((await h.call("hover", { line: 2, column: 21 })).details.hover, /int/);
  await writeFile(header, "inline double value = 42.0;\n");
  const changed = await h.call("hover", { line: 2, column: 21 });
  assert.equal(changed.details.error, undefined, changed.content[0].text);
  assert.match(changed.details.hover, /double/);
});

async function connection(t: any, args: string[] = []) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-clangd-conn-"));
  const client = new ClangdConnection(cwd, undefined, { command: process.execPath, args: [fixture, ...args], timeoutMs: 1000 });
  t.after(async () => { await client.close(); await rm(cwd, { recursive: true, force: true }); });
  return { cwd, client };
}
async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await new Promise(done => setTimeout(done, 10));
  }
}

test("progress create is answered with null and background index state moves from not started to indexing to idle", async t => {
  const { cwd, client } = await connection(t);
  const file = join(cwd, "a.cpp");
  assert.equal(client.indexState, "not-started");
  await writeFile(file, "INDEX-BEGIN");
  await client.syncFile(file);
  await until(() => client.indexState === "indexing");
  assert.equal(await client.waitForIndexIdle(50), "indexing", "a bounded wait reports the incomplete state");
  const idle = client.waitForIndexIdle(2000);
  await writeFile(file, "INDEX-END");
  await client.syncFile(file);
  assert.equal(await idle, "idle");
  assert.equal(client.indexState, "idle");
});

test("diagnostics waiters match the synced version and time out as pending", async t => {
  const { cwd, client } = await connection(t);
  const file = join(cwd, "a.cpp");
  await writeFile(file, "DIAG one");
  const first = await client.syncFile(file);
  assert.equal(first.version, 1);
  assert.equal(first.uri, pathToFileURL(file).href);
  const v1 = client.waitForDiagnostics(file, 1, 2000);
  const v2 = client.waitForDiagnostics(file, 2, 2000);
  let v2Settled = false;
  void v2.then(() => { v2Settled = true; });
  const one = await v1;
  assert.equal(one.status, "ready");
  assert.match(one.status === "ready" ? one.diagnostics[0].message : "", /version 1/);
  await new Promise(done => setTimeout(done, 30));
  assert.equal(v2Settled, false, "version-1 diagnostics do not satisfy a version-2 waiter");
  await writeFile(file, "DIAG two");
  assert.equal((await client.syncFile(file)).version, 2);
  const two = await v2;
  assert.equal(two.status, "ready");
  assert.equal(two.status === "ready" && two.version, 2);
  assert.match(two.status === "ready" ? two.diagnostics[0].message : "", /version 2/);

  await writeFile(file, "int clean;");
  const clean = await client.syncFile(file);
  assert.deepEqual(await client.waitForDiagnostics(file, clean.version, 2000), { status: "ready", version: 3, diagnostics: [] });
  assert.deepEqual(await client.waitForDiagnostics(file, 99, 50), { status: "pending" });
});

test("general requests sync the file first and method-not-found is cached as unsupported", async t => {
  const { cwd, client } = await connection(t);
  const file = join(cwd, "a.cpp");
  await writeFile(file, "int x;");
  const uri = pathToFileURL(file).href;
  const hover = await client.request("textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 4 } }, { file });
  assert.equal(JSON.parse(hover.contents.value).version, 1);
  const item = { name: "f", kind: 12, uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } };
  await assert.rejects(client.request("callHierarchy/outgoingCalls", { item }), (error: Error) => error instanceof ClangdUnsupportedError && /callHierarchy\/outgoingCalls is not supported by this clangd version/.test(error.message));
  await assert.rejects(client.request("callHierarchy/outgoingCalls", { item }), /not supported by this clangd version/);
  const counts = await client.request("mock/requests", null);
  assert.equal(counts["callHierarchy/outgoingCalls"], 1, "the cached failure sends no second request");
  assert.equal(client.alive, true);
});

test("extra startup args follow the default flags", async t => {
  const { cwd, client } = await connection(t);
  const file = join(cwd, "a.cpp");
  await writeFile(file, "int x;");
  const argv = await client.request("mock/argv", null);
  assert.ok(argv.indexOf("--background-index=false") >= 0);
  const extra = new ClangdConnection(cwd, undefined, { command: process.execPath, args: [fixture], extraArgs: ["--background-index"], timeoutMs: 1000 });
  t.after(() => extra.close());
  const extraArgv: string[] = await extra.request("mock/argv", null);
  assert.ok(extraArgv.includes("--background-index"));
  assert.ok(!extraArgv.includes("--background-index=false"), "an extra arg replaces the default with the same name");
  assert.ok(extraArgv.includes("--log=error"));
});

/** Flag names (the part before `=`) that occur more than once; clangd 14 and older refuse to start on a repeated flag. */
function repeatedFlags(argv: string[]): string[] {
  const names = argv.filter(arg => arg.startsWith("--")).map(arg => arg.split("=")[0]);
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

test("real clangd advertises references, rename, call and type hierarchy providers", { skip: !clangdAvailable }, async t => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-clangd-caps-"));
  const client = new ClangdConnection(cwd, undefined, { timeoutMs: 15_000 });
  t.after(async () => { await client.close(); await rm(cwd, { recursive: true, force: true }); });
  const capabilities = await client.serverCapabilities();
  assert.ok(capabilities.referencesProvider);
  assert.equal(capabilities.renameProvider?.prepareProvider, true);
  assert.ok(capabilities.callHierarchyProvider);
  assert.ok(capabilities.typeHierarchyProvider);
});


// ---------------------------------------------------------------------------
// Managed connection (KTD11, KTD16)

/** A project service stand-in whose model is ready from the start. */
function readyProject(cwd: string, source: string, buildDir: string) {
  const model = { sourceRoot: cwd, buildDir, targets: [{ isProjectTarget: true, sources: [{ path: join(cwd, "missing.cpp"), isGenerated: false, language: "CXX" }, { path: source, isGenerated: false, language: "CXX" }] }] } as unknown as ProjectModel;
  return { model, onModelChange: () => () => {} } as unknown as ProjectService;
}

async function managedMock(t: any, extra: string[] = []) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-clangd-managed-"));
  const source = join(cwd, "main.cpp");
  const buildDir = join(cwd, "managed");
  await writeFile(source, "int main() {}\n");
  await mkdir(buildDir);
  await writeFile(join(buildDir, "compile_commands.json"), "[]");
  const project = readyProject(cwd, source, buildDir);
  const registered = register({ command: process.execPath, args: [fixture, ...extra], timeoutMs: 1000, getProject: () => project });
  t.after(async () => { await registered.emit("session_shutdown"); await rm(cwd, { recursive: true, force: true }); });
  await registered.emit("session_start");
  return { ...registered, cwd, source, buildDir };
}

test("the managed connection starts with the index flags and opens a project source, while an explicit build_dir keeps the index off", async t => {
  const h = await managedMock(t);
  const managed = await h.managed.connection();
  assert.ok(managed, "the managed connection starts when the model is ready");
  const argv: string[] = await managed.request("mock/argv", null);
  assert.ok(argv.includes("--background-index"));
  assert.deepEqual(repeatedFlags(argv), [], `each flag appears once: ${argv.join(" ")}`);
  assert.ok(argv.includes("--background-index-priority=low"));
  assert.ok(argv.includes("--rename-file-limit=0"));
  assert.ok(argv.includes(`--compile-commands-dir=${h.buildDir}`));
  assert.deepEqual(await managed.request("mock/documents", null), [pathToFileURL(h.source).href]);

  const implicit = await h.tools.get("cpp_hover").execute("call", { file: h.source, line: 1, column: 5 }, undefined, undefined, { cwd: h.cwd });
  assert.equal(JSON.parse(implicit.details.hover).buildDir, `--compile-commands-dir=${h.buildDir}`);
  assert.equal(implicit.details.build_dir, h.buildDir);
  assert.match(implicit.content[0].text, new RegExp(`compile database: ${h.buildDir}`));

  const explicit = await h.tools.get("cpp_hover").execute("call", { file: h.source, line: 1, column: 5, build_dir: "managed" }, undefined, undefined, { cwd: h.cwd });
  const explicitArgv: string[] = JSON.parse(explicit.details.hover).argv;
  assert.ok(explicitArgv.includes("--background-index=false"));
  assert.ok(!explicitArgv.includes("--background-index"), "an explicit build_dir never writes an index");
  assert.ok(!explicitArgv.includes("--rename-file-limit=0"));
});

test("index flags an older clangd does not list are left out", async t => {
  const h = await managedMock(t, ["old-help"]);
  const argv: string[] = await (await h.managed.connection())!.request("mock/argv", null);
  assert.ok(argv.includes("--background-index"));
  assert.ok(!argv.some(arg => arg.startsWith("--background-index-priority") || arg.startsWith("--rename-file-limit")), argv.join(" "));
});

const cmakeAvailable = spawnSync("cmake", ["--version"]).status === 0;
const realProjectTools = clangdAvailable && cmakeAvailable;

// A child_process executor with pi.exec's contract: no shell, kill on abort or timeout.
function nodeExec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise(done => {
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
}

function listTree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" });
}

/** A real ProjectService on a copy of the clangd fixture, with the managed cache in a temp dir. */
async function realProject(t: any) {
  const previousCache = process.env.XDG_CACHE_HOME;
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), "pi-clangd-project-")));
  process.env.XDG_CACHE_HOME = join(scratch, "cache");
  const root = join(scratch, "clangd");
  cpSync(resolve("tests/fixtures/cmake/clangd"), root, { recursive: true });
  const before = listTree(root).sort();
  const project = new ProjectService({ cwd: root, exec: nodeExec });
  const registered = register({ timeoutMs: 30_000, getProject: () => project });
  t.after(async () => {
    await registered.emit("session_shutdown");
    project.dispose();
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previousCache;
    await rm(scratch, { recursive: true, force: true });
  });
  await registered.emit("session_start");
  await until(() => project.status === "ready", 60_000);
  return { ...registered, project, root, before, cache: process.env.XDG_CACHE_HOME };
}

test("real clangd indexes the managed project outside its tree, starting with no tool call", { skip: !realProjectTools }, async t => {
  const h = await realProject(t);
  const connection = (await h.managed.connection())!;
  assert.ok(connection, "the managed connection starts once the model is ready");
  await until(() => connection.indexState !== "not-started", 30_000);
  assert.equal(await connection.waitForIndexIdle(60_000), "idle");

  const symbols = await connection.request("workspace/symbol", { query: "compute_widget_total" });
  assert.ok(symbols.some((symbol: any) => symbol.name === "compute_widget_total" && symbol.location.uri === pathToFileURL(join(h.root, "widget.cpp")).href), JSON.stringify(symbols));

  const hover = await h.tools.get("cpp_hover").execute("call", { file: "main.cpp", line: 1, column: 20 }, undefined, undefined, { cwd: h.root });
  assert.equal(hover.details.error, undefined, hover.content[0].text);
  assert.match(hover.details.hover, /double/, "the fixture's compile definition reaches clangd");
  assert.equal(hover.details.build_dir, h.project.buildDir);

  const buildDir = h.project.buildDir!;
  assert.ok(buildDir.startsWith(h.cache!), buildDir);
  assert.ok(readdirSync(join(buildDir, ".cache", "clangd", "index")).some(name => name.startsWith("widget.cpp.")));
  assert.deepEqual(listTree(h.root).sort(), h.before, "nothing is written into the project tree");
  assert.equal(existsSync(join(h.root, ".cache")), false);
});

test("real clangd restarts after a reconfigure that adds a source, and the new source resolves", { skip: !realProjectTools }, async t => {
  const h = await realProject(t);
  const first = (await h.managed.connection())!;
  await writeFile(join(h.root, "added.cpp"), "MANAGED_VALUE_TYPE added_value = 2;\n");
  const lists = join(h.root, "CMakeLists.txt");
  writeFileSync(lists, readFileSync(lists, "utf8").replace("widget.cpp)", "widget.cpp added.cpp)"));
  const later = new Date(Date.now() + 2000);
  utimesSync(lists, later, later);
  await h.project.reportPoint();
  await until(() => h.project.model!.targets.some(target => target.sources.some(source => source.path.endsWith("added.cpp"))), 60_000);

  const second = (await h.managed.connection())!;
  assert.notEqual(second, first, "a changed compile database restarts the connection");
  assert.equal(first.alive, false);
  const hover = await h.tools.get("cpp_hover").execute("call", { file: "added.cpp", line: 1, column: 20 }, undefined, undefined, { cwd: h.root });
  assert.equal(hover.details.error, undefined, hover.content[0].text);
  assert.match(hover.details.hover, /double/);
});
