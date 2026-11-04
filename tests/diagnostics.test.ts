import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExecOptions, ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/index.ts";
import { ClangdConnection, type Diagnostic } from "../extensions/lib/clangd.ts";
import { COMPILER_CHECK_TIMEOUT_MS, parseCompilerOutput, postEditNote, checkWithCompiler } from "../extensions/lib/diagnostics.ts";
import type { Exec } from "../extensions/lib/project/configure.ts";
import type { ProjectModel } from "../extensions/lib/project/model.ts";
import { ProjectService } from "../extensions/lib/project/session.ts";
import { ToolchainService, type TargetProfile } from "../extensions/lib/toolchain.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "cmake");
const hasCmake = spawnSync("cmake", ["--version"]).status === 0;
const hasClangd = spawnSync("clangd", ["--version"]).status === 0;
const hasClangFormat = spawnSync("clang-format", ["--version"]).status === 0;

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

/** pi.exec for a missing binary: it resolves with a non-zero code instead of throwing. */
const noClangFormat: Exec = (command, args, options) => command === "clang-format"
  ? Promise.resolve({ stdout: "", stderr: "clang-format: not found", code: 127, killed: false })
  : nodeExec(command, args, options);
/** A clang-format that reports success without touching the file. */
const fakeClangFormat: Exec = (command, args, options) => command === "clang-format"
  ? Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false })
  : nodeExec(command, args, options);

/**
 * A minimal LSP peer: it answers initialize and shutdown and, on every didOpen, publishes the
 * diagnostics given as its first argument at the opened version. With `null` it never publishes.
 */
const PEER = `
const diagnostics = JSON.parse(process.argv[1]);
let buffer = Buffer.alloc(0);
const send = message => { const body = JSON.stringify({ jsonrpc: "2.0", ...message }); process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body); };
process.stdin.on("data", chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\\r\\n\\r\\n");
    if (end < 0) return;
    const length = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    if (message.method === "initialize") send({ id: message.id, result: { capabilities: { positionEncoding: "utf-16" } } });
    else if (message.method === "shutdown") send({ id: message.id, result: null });
    else if (message.method === "exit") process.exit(0);
    else if (message.method === "textDocument/didOpen" && diagnostics) {
      const { uri, version } = message.params.textDocument;
      send({ method: "textDocument/publishDiagnostics", params: { uri, version, diagnostics } });
    }
  }
});`;

async function peer(t: any, diagnostics: Diagnostic[] | null, name = "src/widget.cpp") {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-diag-")));
  const file = join(cwd, name);
  mkdirSync(dirname(file));
  writeFileSync(file, "int main() { return 0; }\n");
  const connection = new ClangdConnection(cwd, undefined, { command: process.execPath, args: ["-e", PEER, JSON.stringify(diagnostics)], timeoutMs: 5000 });
  t.after(async () => { await connection.close(); rmSync(cwd, { recursive: true, force: true }); });
  return { cwd, file, clangd: { connection: async () => connection } };
}

const diagnostic = (line: number, severity: number, message: string): Diagnostic =>
  ({ range: { start: { line, character: 4 }, end: { line, character: 8 } }, severity, message });

test("a clangd that never publishes reads diagnostics pending, never clean, within the bound", async t => {
  const p = await peer(t, null);
  const started = Date.now();
  const note = await postEditNote(p.file, { cwd: p.cwd, exec: noClangFormat, clangd: p.clangd, waitMs: 200, firstOpenWaitMs: 400 });
  assert.ok(Date.now() - started < 3000, "the wait is bounded");
  assert.match(note!, /^\[cpp-lsp\] diagnostics pending/);
  assert.doesNotMatch(note!, /no problems/);
});

test("with clang-format absent, diagnostics still appear", async t => {
  const p = await peer(t, [diagnostic(2, 1, "use of undeclared identifier 'oops'")]);
  const note = await postEditNote(p.file, { cwd: p.cwd, exec: noClangFormat, clangd: p.clangd, waitMs: 2000, firstOpenWaitMs: 4000 });
  assert.equal(note, "[cpp-lsp] diagnostics: 1 error\nsrc/widget.cpp:3:5: error: use of undeclared identifier 'oops'");
});

test("a clean file reads no problems once clangd answered for the synced version", async t => {
  const p = await peer(t, [diagnostic(0, 3, "an information note"), diagnostic(1, 4, "a hint")]);
  const note = await postEditNote(p.file, { cwd: p.cwd, exec: noClangFormat, clangd: p.clangd, waitMs: 2000, firstOpenWaitMs: 4000 });
  assert.equal(note, "[cpp-lsp] diagnostics: no problems");
});

test("with clangd absent, formatting, drift and owner still appear and diagnostics are skipped silently", async t => {
  const p = await peer(t, null);
  const project = {
    reportPoint: async () => "[cpp-lsp] New: src/widget.cpp belongs to no target",
    ownerOf: (path: string) => path === p.file ? { targets: ["legacy"], standard: "14", standardText: "C++14" } : undefined,
  };
  const expected = "[cpp-lsp] Formatted with clang-format ✓\nNew: src/widget.cpp belongs to no target\nowner legacy (C++14)";
  const none = await postEditNote(p.file, { cwd: p.cwd, exec: fakeClangFormat, project, clangd: { connection: async () => undefined } });
  assert.equal(none, expected);
  const missing = new ClangdConnection(p.cwd, undefined, { command: join(p.cwd, "no-such-clangd"), timeoutMs: 2000 });
  t.after(() => missing.close());
  const failed = await postEditNote(p.file, { cwd: p.cwd, exec: fakeClangFormat, project, clangd: { connection: async () => missing } });
  assert.equal(failed, expected);
});

test("more than 20 diagnostics are capped, errors listed before warnings", async t => {
  const warnings = Array.from({ length: 15 }, (_, line) => diagnostic(line, 2, `warning ${line + 1}`));
  const errors = Array.from({ length: 10 }, (_, index) => diagnostic(20 + index, 1, `error ${index + 1}`));
  const p = await peer(t, [...warnings, diagnostic(40, 3, "info"), ...errors]);
  const note = await postEditNote(p.file, { cwd: p.cwd, exec: noClangFormat, clangd: p.clangd, waitMs: 2000, firstOpenWaitMs: 4000 });
  const lines = note!.split("\n");
  assert.equal(lines[0], "[cpp-lsp] diagnostics: 10 errors, 15 warnings (first 20 shown)");
  assert.equal(lines.length, 21);
  assert.deepEqual(lines.slice(1, 11), errors.map((_, index) => `src/widget.cpp:${21 + index}:5: error: error ${index + 1}`));
  assert.deepEqual(lines.slice(11), warnings.slice(0, 10).map((_, line) => `src/widget.cpp:${line + 1}:5: warning: warning ${line + 1}`));
});

// ---------------------------------------------------------------------------
// The build compiler's check in targets whose compiler supports features clangd lacks

type CompilerCall = { command: string; args: string[]; options: ExecOptions };

/** pi.exec without clang-format, where the build compiler answers with `answer`; records each compiler run. */
function compilerExec(answer: ExecResult) {
  const calls: CompilerCall[] = [];
  const exec: Exec = async (command, args, options = {}) => {
    if (command === "clang-format") return { stdout: "", stderr: "clang-format: not found", code: 127, killed: false };
    calls.push({ command, args, options });
    return answer;
  };
  return { calls, exec };
}

/**
 * A mock clangd peer for `name` in a project whose build directory holds a compilation database
 * entry for src/widget.cpp, and a gap profile like GCC 16 with -freflection against clangd 23.
 */
async function gapProject(t: any, diagnostics: Diagnostic[], name = "src/widget.cpp", family: TargetProfile["family"] = "gcc") {
  const p = await peer(t, diagnostics, name);
  const build = join(p.cwd, "build");
  mkdirSync(build);
  const source = join(p.cwd, "src", "widget.cpp");
  const argv = [family === "clang" ? "clang++" : "g++", "-std=c++26", "-freflection", "-o", "widget.o", "-c", source];
  writeFileSync(join(build, "compile_commands.json"), JSON.stringify([{ directory: build, file: source, arguments: argv }]));
  const profile: TargetProfile = {
    target: "app", standard: 26, compiler: family === "clang" ? "clang++ 23" : "g++ 16", family,
    available: ["reflection", "contracts"], needsFlag: {}, clangdLacks: ["contracts", "reflection"], gap: true,
    entry: { file: source, directory: build, argv },
  };
  const project = { ownerOf: () => undefined, model: { buildDir: build } as ProjectModel };
  const gapFiles = new Set([p.file]);
  const toolchain = { gapProfileFor: (file: string) => gapFiles.has(file) ? profile : undefined };
  return { ...p, build, source, project, toolchain, gapFiles };
}

const clangdError = diagnostic(0, 1, "expected expression");
const bounds = { waitMs: 2000, firstOpenWaitMs: 4000 };

test("in a gap target the build compiler's clean verdict replaces clangd's errors and names the compiler", async t => {
  const g = await gapProject(t, [clangdError]);
  const { calls, exec } = compilerExec({ stdout: "", stderr: "", code: 0, killed: false });
  const note = await postEditNote(g.file, { cwd: g.cwd, exec, project: g.project, clangd: g.clangd, toolchain: g.toolchain, ...bounds });
  assert.equal(note, "[cpp-lsp] diagnostics: no problems\nchecked by g++ 16");
  assert.equal(calls.length, 1);
  const [call] = calls;
  // The same invocation cpp_compile uses: the entry's command from the project's build directory.
  assert.equal(call!.command, "g++");
  assert.deepEqual(call!.args, ["-std=c++26", "-freflection", g.source, "-fsyntax-only", "-fdiagnostics-plain-output"]);
  assert.equal(call!.options.cwd, g.build);
  assert.equal(call!.options.timeout, COMPILER_CHECK_TIMEOUT_MS);
  assert.equal(COMPILER_CHECK_TIMEOUT_MS, 15_000);
});

test("in a gap target a real error from the build compiler is shown at its line, without clangd's errors", async t => {
  const g = await gapProject(t, [clangdError]);
  const stderr = `${g.source}: In function 'int area()':\n${g.source}:3:12: error: invalid conversion from 'const char*' to 'int' [-fpermissive]\n`;
  const { exec } = compilerExec({ stdout: "", stderr, code: 1, killed: false });
  const note = await postEditNote(g.file, { cwd: g.cwd, exec, project: g.project, clangd: g.clangd, toolchain: g.toolchain, ...bounds });
  assert.equal(note, "[cpp-lsp] diagnostics: 1 error\nsrc/widget.cpp:3:12: error: invalid conversion from 'const char*' to 'int' [-fpermissive]\nchecked by g++ 16");
  assert.doesNotMatch(note!, /expected expression/);
});

test("outside a gap target clangd's errors are the note, unchanged, and the compiler does not run", async t => {
  const g = await gapProject(t, [clangdError]);
  g.gapFiles.clear();
  const { calls, exec } = compilerExec({ stdout: "", stderr: "", code: 0, killed: false });
  const note = await postEditNote(g.file, { cwd: g.cwd, exec, project: g.project, clangd: g.clangd, toolchain: g.toolchain, ...bounds });
  assert.equal(note, "[cpp-lsp] diagnostics: 1 error\nsrc/widget.cpp:1:5: error: expected expression");
  assert.equal(calls.length, 0);
});

test("a file clangd finds clean in a gap target does not run the compiler", async t => {
  const g = await gapProject(t, [diagnostic(0, 2, "unused variable 'x'")]);
  const { calls, exec } = compilerExec({ stdout: "", stderr: "", code: 0, killed: false });
  const note = await postEditNote(g.file, { cwd: g.cwd, exec, project: g.project, clangd: g.clangd, toolchain: g.toolchain, ...bounds });
  assert.equal(note, "[cpp-lsp] diagnostics: 1 warning\nsrc/widget.cpp:1:5: warning: unused variable 'x'");
  assert.equal(calls.length, 0);
});

test("a compiler check that does not finish in time keeps clangd's errors in the note and logs why", async t => {
  const g = await gapProject(t, [clangdError]);
  // pi.exec kills the compiler at the timeout and reports it as killed.
  const { exec } = compilerExec({ stdout: "", stderr: "", code: 1, killed: true });
  const logged: string[] = [];
  const note = await postEditNote(g.file, { cwd: g.cwd, exec, project: g.project, clangd: g.clangd, toolchain: g.toolchain, log: line => logged.push(line), ...bounds });
  assert.equal(note, "[cpp-lsp] diagnostics: 1 error\nsrc/widget.cpp:1:5: error: expected expression");
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /widget\.cpp: g\+\+ 16 could not check it, so clangd's diagnostics stand \(clangd lacks static reflection, contracts\): it did not finish within 15s$/);
});

test("a compiler that fails without reporting an error in the file counts as not having checked it", async t => {
  const g = await gapProject(t, [clangdError]);
  const { exec } = compilerExec({ stdout: "", stderr: "g++: error: unrecognized command-line option '-freflection'\n", code: 1, killed: false });
  const logged: string[] = [];
  const note = await postEditNote(g.file, { cwd: g.cwd, exec, project: g.project, clangd: g.clangd, toolchain: g.toolchain, log: line => logged.push(line), ...bounds });
  assert.equal(note, "[cpp-lsp] diagnostics: 1 error\nsrc/widget.cpp:1:5: error: expected expression");
  assert.match(logged[0]!, /could not check it.*g\+\+: error: unrecognized command-line option '-freflection'$/);
});

test("an edited header in a gap target is compiled on its own with the target's borrowed command", async t => {
  const g = await gapProject(t, [clangdError], "src/widget.hpp", "clang");
  const { calls, exec } = compilerExec({ stdout: "", stderr: "", code: 0, killed: false });
  const note = await postEditNote(g.file, { cwd: g.cwd, exec, project: g.project, clangd: g.clangd, toolchain: g.toolchain, ...bounds });
  assert.equal(note, "[cpp-lsp] diagnostics: no problems\nchecked by clang++ 23");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.command, "clang++");
  assert.equal(calls[0]!.options.cwd, g.build);
  assert.deepEqual(calls[0]!.args, ["-std=c++26", "-freflection", "-x", "c++", "-Wno-pragma-once-outside-header", "-fno-color-diagnostics", "-fno-caret-diagnostics", "-fsyntax-only", g.file]);
});

test("compiler output keeps only its error and warning lines, dropping notes, carets and include context", () => {
  const output = [
    "In file included from bad.cpp:1:",
    "bad.hpp: In function 'int h()':",
    "bad.hpp:3:30: error: invalid conversion from 'const char*' to 'int' [-fpermissive]",
    "    3 | int h() { return \"x\"; }",
    "      |                  ^~~",
    "bad.hpp:3:15: warning: unused variable 'unused' [-Wunused-variable]",
    "bad.hpp: In instantiation of 'int g(T) [with T = int]':",
    "bad.cpp:2:22:   required from here",
    "bad.cpp:2:21: note: in instantiation of function template specialization 'g<int>' requested here",
    "/abs/missing.cpp:1:10: fatal error: nothere.h: No such file or directory",
    "compilation terminated.",
  ].join("\n");
  assert.deepEqual(parseCompilerOutput(output, "/work/build"), [
    { file: "/work/build/bad.hpp", line: 3, column: 30, severity: "error", message: "invalid conversion from 'const char*' to 'int' [-fpermissive]" },
    { file: "/work/build/bad.hpp", line: 3, column: 15, severity: "warning", message: "unused variable 'unused' [-Wunused-variable]" },
    { file: "/abs/missing.cpp", line: 1, column: 10, severity: "error", message: "nothere.h: No such file or directory" },
  ]);
});

// ---------------------------------------------------------------------------
// The real pipeline: the extension's tool_result hook, a real ProjectService and the managed clangd

function copyFixture(name: string): string {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-diag-")));
  const root = join(scratch, name);
  cpSync(join(fixtures, name), root, { recursive: true });
  return root;
}

async function session(t: any, cwd: string) {
  const previousCache = process.env.XDG_CACHE_HOME;
  const cache = mkdtempSync(join(tmpdir(), "pi-cpp-cache-"));
  process.env.XDG_CACHE_HOME = cache;
  const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
  const api = {
    exec: nodeExec,
    registerTool() {},
    registerCommand() {},
    on(name: string, handler: any) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
  };
  // Generous bounds keep a loaded machine from turning a real answer into "pending".
  extension(api as unknown as ExtensionAPI, { project: { waitMs: 60_000 }, diagnostics: { waitMs: 20_000, firstOpenWaitMs: 40_000 } });
  const ctx = { cwd, isProjectTrusted: () => true, ui: { notify() {} } };
  const emit = async (name: string, event: any) => {
    let last: unknown;
    for (const handler of handlers.get(name) ?? []) {
      const value = await handler({ type: name, ...event }, ctx);
      if (value !== undefined) last = value;
    }
    return last as any;
  };
  t.after(async () => {
    await emit("session_shutdown", { reason: "quit" });
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previousCache;
    rmSync(cache, { recursive: true, force: true });
    rmSync(dirname(cwd), { recursive: true, force: true });
  });
  await emit("session_start", { reason: "startup" });
  await emit("before_agent_start", { systemPrompt: "", systemPromptOptions: {}, messageType: "user", prompt: "hi" });
  return {
    /** Writes `text` to `path` as pi's tool would, then returns the note the tool_result hook appended. */
    async toolResult(toolName: "write" | "edit", path: string, text: string) {
      writeFileSync(join(cwd, path), text);
      const content = [{ type: "text", text: "Successfully wrote the file" }];
      const result = await emit("tool_result", { toolName, toolCallId: "call", input: { path }, content, isError: false, details: undefined });
      assert.ok(result?.content, "the hook appends a note");
      assert.deepEqual(result.content.slice(0, 1), content, "the original content stays first and unchanged");
      assert.equal(result.isError, undefined, "the hook never flips isError");
      assert.equal(result.content.length, 2, "one combined note");
      return result.content[1].text as string;
    },
  };
}

test("write and edit results carry clang-format, owner and real clangd diagnostics in one note", { skip: !hasCmake || !hasClangd }, async t => {
  const root = copyFixture("multi");
  const s = await session(t, root);

  // An unformatted type error in a file of the C++14 target (AE8).
  const legacy = "libs/legacy/legacy.cpp";
  const broken = await s.toolResult("write", legacy, '#include "legacy.h"\nint   legacy_value( ) {return "x";}\n');
  const onDisk = readFileSync(join(root, legacy), "utf8").split("\n")[1]!;
  if (hasClangFormat) {
    assert.equal(onDisk, 'int legacy_value() { return "x"; }', "the file is formatted before clangd sees it");
    assert.match(broken, /^\n\[cpp-lsp\] Formatted with clang-format ✓\n/);
  }
  assert.match(broken, /\nowner legacy \(C\+\+14\)\n/);
  assert.match(broken, /\ndiagnostics: 1 error\n/);
  assert.match(broken, new RegExp(`\\nlibs/legacy/legacy\\.cpp:2:${onDisk.indexOf('"x"') + 1}: error: .*'int'`), "the error points into the formatted text");
  assert.ok(broken.indexOf("owner legacy") < broken.indexOf("diagnostics:"), "owner before diagnostics");

  const clean = await s.toolResult("edit", legacy, '#include "legacy.h"\nint legacy_value() { return shared_value(); }\n');
  assert.match(clean, /\nowner legacy \(C\+\+14\)\ndiagnostics: no problems$/);
  assert.doesNotMatch(clean, /pending/);

  // A header gets its own diagnostics.
  const header = "libs/legacy/include/legacy.h";
  const headerNote = await s.toolResult("edit", header, "#pragma once\nint legacy_value();\nint shared_value();\ninline int broken() { return missing_name; }\n");
  assert.match(headerNote, /\nlibs\/legacy\/include\/legacy\.h:4:\d+: error: .*missing_name/);
});

test("non-C/C++ files skip formatting and diagnostics but still reconfigure and report drift", { skip: !hasCmake || !hasClangd }, async t => {
  const root = copyFixture("multi");
  const s = await session(t, root);
  const added = await s.toolResult("write", "libs/legacy/newer.cpp", "int newer_value() { return 3; }\n");
  assert.match(added, /New: libs\/legacy\/newer\.cpp.*no target/);
  assert.match(added, /diagnostics: no problems/);

  const lists = "libs/legacy/CMakeLists.txt";
  const text = readFileSync(join(root, lists), "utf8").replace("legacy.cpp shared.cpp", "legacy.cpp   shared.cpp newer.cpp");
  const resolved = await s.toolResult("edit", lists, text);
  assert.match(resolved, /Resolved: libs\/legacy\/newer\.cpp/);
  assert.doesNotMatch(resolved, /Formatted|diagnostics|owner/);
  assert.equal(readFileSync(join(root, lists), "utf8"), text, "CMakeLists.txt is never formatted");
});

// ---------------------------------------------------------------------------
// The build compiler's check against real GCC, CMake and clangd

const gccReflects = spawnSync("g++", ["-std=c++26", "-freflection", "-x", "c++", "-fsyntax-only", "-"], { input: "int main() {}\n" }).status === 0;

async function until(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the condition");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

test("with real GCC 16 reflection and contracts, the post-edit note reads no problems checked by g++ where clangd alone reports errors", { skip: !gccReflects || !hasCmake || !hasClangd }, async t => {
  const previous = { cache: process.env.XDG_CACHE_HOME, cxx: process.env.CXX };
  const cache = mkdtempSync(join(tmpdir(), "pi-cpp-cache-"));
  process.env.XDG_CACHE_HOME = cache;
  // The fixture needs GCC; CMake picks the compiler from CXX on the first configure.
  process.env.CXX = "g++";
  const root = copyFixture("cxx26");
  const project = new ProjectService({ cwd: root, exec: nodeExec });
  const toolchain = new ToolchainService({ exec: nodeExec, clangdTimeoutMs: 60_000 });
  let connection: ClangdConnection | undefined;
  t.after(async () => {
    await connection?.close();
    toolchain.close();
    project.dispose();
    for (const [name, value] of [["XDG_CACHE_HOME", previous.cache], ["CXX", previous.cxx]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(cache, { recursive: true, force: true });
    rmSync(dirname(root), { recursive: true, force: true });
  });
  await until(() => project.model !== undefined, 120_000);
  toolchain.attach(project);
  await toolchain.settled();
  assert.equal(toolchain.gapProfileFor(join(root, "src", "main.cpp"))?.compiler, "g++ 16");

  connection = new ClangdConnection(root, project.buildDir, { timeoutMs: 60_000 });
  const clangd = { connection: async () => connection };
  const generous = { exec: noClangFormat, cwd: root, project, clangd, waitMs: 20_000, firstOpenWaitMs: 40_000 };
  for (const path of ["src/main.cpp", "include/describe.hpp"]) {
    const file = join(root, path);
    const alone = await postEditNote(file, generous);
    assert.match(alone!, /(?:^\[cpp-lsp\] |\n)diagnostics: \d+ errors?/, `clangd alone reports errors in ${path}`);
    const checked = await postEditNote(file, { ...generous, toolchain });
    assert.match(checked!, /(?:^\[cpp-lsp\] |\n)diagnostics: no problems\nchecked by g\+\+ 16$/m, `${path}: ${checked}`);
  }
});

test("every kind of included file borrows its target's command, not only .h and .hpp", async () => {
  const profile = {
    target: "app", standard: 26 as const, compiler: "g++ 16", family: "gcc" as const, available: [], needsFlag: {}, clangdLacks: ["contracts"], gap: true,
    entry: { file: "/project/src/a.cpp", directory: "/project/build", argv: ["g++", "-std=c++26", "-c", "/project/src/a.cpp"] },
  };
  for (const file of ["/project/include/impl.tpp", "/project/include/inline.inl", "/project/include/detail.ipp"]) {
    const calls: string[][] = [];
    const result = await checkWithCompiler(file, profile, {
      cwd: "/project",
      exec: async (_command, args) => { calls.push(args); return { stdout: "", stderr: "", code: 0, killed: false }; },
    });
    assert.ok(result.ok, file);
    assert.deepEqual(calls[0]!.slice(-3), ["-fdiagnostics-plain-output", "-fsyntax-only", file]);
    assert.ok(calls[0]!.includes("-x"), file);
  }
});
