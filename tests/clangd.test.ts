import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { pathToFileURL } from "node:url";
import { ClangdConnection, ClangdUnsupportedError, registerClangdTools, type ClangdOptions } from "../extensions/lib/clangd.ts";

const fixture = resolve("tests/fixtures/mock-clangd.mjs");
async function harness(t: any, options: ClangdOptions = { command: process.execPath, args: [fixture], timeoutMs: 1000 }) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-clangd-test-"));
  const file = join(cwd, "hello world.cpp");
  await writeFile(file, "int value = 42;\nint main() { return value; }\n");
  const tools = new Map<string, any>();
  let shutdown = async () => {};
  registerClangdTools({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (_name: string, callback: any) => { shutdown = callback; } } as unknown as ExtensionAPI, options);
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
  assert.ok(extraArgv.indexOf("--background-index") > extraArgv.indexOf("--background-index=false"));
});

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
