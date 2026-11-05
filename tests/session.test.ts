import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as pi from "@earendil-works/pi-coding-agent";
import type { ExecOptions, ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/index.ts";
import { postEditNote } from "../packages/core/src/diagnostics.ts";
import type { Exec } from "../packages/core/src/exec.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, truncateOutput } from "../packages/core/src/output.ts";
import { BRIEFING_MESSAGE } from "../packages/core/src/project/session.ts";
import { CppSession } from "../packages/core/src/session.ts";

// The feature probes here would otherwise land in the shared temporary directory, where a test
// in another file counts them while this one runs.
process.env.TMPDIR = mkdtempSync(join(tmpdir(), "pi-cpp-session-tmp-"));

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "cmake");
const mockClangd = resolve(here, "fixtures", "mock-clangd.mjs");
const hasCmake = spawnSync("cmake", ["--version"]).status === 0;

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
/** A clang-format that reports success without touching the file. */
const fakeClangFormat: Exec = (command, args, options) => command === "clang-format"
  ? Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false })
  : nodeExec(command, args, options);

const mock = { command: process.execPath, args: [mockClangd], timeoutMs: 5000 };

function freshCache(): void {
  process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "pi-cpp-cache-"));
}

function copyFixture(name: string): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-session-"))), name);
  cpSync(join(fixtures, name), root, { recursive: true });
  return root;
}

/** A session on `root` with the mock clangd, once its first configure and feature check finished. */
async function readySession(t: any, root: string): Promise<CppSession> {
  const session = new CppSession({
    cwd: root, exec: fakeClangFormat, waitMs: 60_000,
    clangd: mock, toolchain: { clangd: mock, clangdTimeoutMs: 5000 },
    diagnostics: { waitMs: 5000, firstOpenWaitMs: 10_000 },
  });
  t.after(() => session.dispose());
  await session.project.ready();
  const deadline = Date.now() + 120_000;
  while (session.project.status === "configuring") {
    if (Date.now() > deadline) throw new Error("configure did not finish");
    await new Promise(done => setTimeout(done, 50));
  }
  await session.toolchain.settled();
  return session;
}

test("CppSession.promptMessage gives the briefing, then nothing, then the briefing again after compacted()", { skip: !hasCmake }, async t => {
  freshCache();
  const session = await readySession(t, copyFixture("multi"));
  const first = await session.promptMessage();
  assert.equal(first?.customType, BRIEFING_MESSAGE);
  assert.match(first!.content, /\| legacy \| library \| libs\/legacy \| C\+\+14 \|/);
  assert.equal(await session.promptMessage(), undefined);
  session.compacted();
  const again = await session.promptMessage();
  assert.equal(again?.customType, BRIEFING_MESSAGE);
  assert.match(again!.content, /\| app \| executable \|/);
  assert.deepEqual(await session.guidelines(), [
    "Write C/C++ code that is valid for the C++ standard of the target that owns the file you edit; the project briefing lists each target's standard.",
  ]);
});

test("CppSession.postEditNote gives the note postEditNote gives for the same inputs", { skip: !hasCmake }, async t => {
  freshCache();
  const file = "libs/legacy/legacy.cpp";
  const viaSession = await readySession(t, copyFixture("multi"));
  const direct = await readySession(t, copyFixture("multi"));
  await viaSession.promptMessage();
  await direct.promptMessage();

  // The session resolves a path relative to its directory.
  const note = await viaSession.postEditNote(file);
  const expected = await postEditNote(join(direct.cwd, file), {
    exec: fakeClangFormat, cwd: direct.cwd, project: direct.project, clangd: direct.clangd, toolchain: direct.toolchain, log: direct.log,
    waitMs: 5000, firstOpenWaitMs: 10_000,
  });
  assert.equal(note, expected);
  assert.match(note!, /^\[cpp-lsp\] Formatted with clang-format ✓\nowner legacy \(C\+\+14\)\ndiagnostics: no problems$/);
});

test("the core's head truncation and sizes match pi's truncateHead and formatSize", () => {
  assert.equal(DEFAULT_MAX_LINES, pi.DEFAULT_MAX_LINES);
  assert.equal(DEFAULT_MAX_BYTES, pi.DEFAULT_MAX_BYTES);
  const cases = {
    "past 2000 lines": Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n"),
    "past 2000 lines with a trailing newline": Array.from({ length: 2001 }, (_, i) => `line ${i}\n`).join(""),
    "past 50 KB": Array.from({ length: 600 }, (_, i) => `${i} ${"é".repeat(60)}`).join("\n"),
    "a first line past 50 KB": `${"x".repeat(60_000)}\nshort`,
    "within both limits": "one\ntwo\n",
    empty: "",
  };
  for (const [name, text] of Object.entries(cases)) {
    const theirs = pi.truncateHead(text, { maxLines: pi.DEFAULT_MAX_LINES, maxBytes: pi.DEFAULT_MAX_BYTES });
    const { content, truncated, totalLines, totalBytes, outputLines, outputBytes } = theirs;
    assert.deepEqual(truncateHead(text), { content, truncated, totalLines, totalBytes, outputLines, outputBytes }, name);
  }
  for (const bytes of [0, 1023, 1024, 1536, 50 * 1024, 1024 * 1024 - 1, 1024 * 1024, 5.5 * 1024 * 1024]) {
    assert.equal(formatSize(bytes), pi.formatSize(bytes), String(bytes));
  }
});

test("truncated tool output reads as it did with pi's truncation and keeps the full text in a file", () => {
  for (const output of [Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n"), "y".repeat(80) + "\n" + "z".repeat(60 * 1024)]) {
    const theirs = pi.truncateHead(output, { maxLines: pi.DEFAULT_MAX_LINES, maxBytes: pi.DEFAULT_MAX_BYTES });
    const prefix = `${theirs.content}\n\n[Output truncated: ${theirs.outputLines} of ${theirs.totalLines} lines (${pi.formatSize(theirs.outputBytes)} of ${pi.formatSize(theirs.totalBytes)}). Full output saved to: `;
    const text = truncateOutput(output);
    assert.ok(text.startsWith(prefix), text.slice(-200));
    assert.ok(text.endsWith("]"));
    const file = text.slice(prefix.length, -1);
    assert.equal(readFileSync(file, "utf8"), output);
    rmSync(dirname(file), { recursive: true, force: true });
  }
  assert.equal(truncateOutput("short"), "short");
});

test("the pi adapter's untrusted note and cpp_project answer keep their 2.0.0 wording", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-untrusted-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.14)\nproject(untrusted CXX)\n");
  const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
  const tools = new Map<string, any>();
  const notifications: string[] = [];
  const executed: string[] = [];
  extension({
    exec: async (command: string) => { executed.push(command); return { code: 1, stdout: "", stderr: "", killed: false }; },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand() {},
    on(name: string, handler: any) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
  } as unknown as ExtensionAPI);
  const ctx = { cwd: root, isProjectTrusted: () => false, ui: { notify: (message: string) => notifications.push(message) } };
  const emit = async (name: string, event: any = {}) => { for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx); };
  t.after(() => emit("session_shutdown", { reason: "quit" }));
  await emit("session_start", { reason: "startup" });

  const steps = "trust the project with /trust and restart pi, or start pi with --approve";
  const reason = "pi does not trust this project, and configuring it would run the project's CMake code";
  assert.deepEqual(notifications, [
    `pi-cpp-lsp: ${root} is a CMake project, but ${reason}. Project briefing and drift detection are off for this session; to enable them, ${steps}.`,
  ]);
  const overview = await tools.get("cpp_project").execute("call", { action: "overview" }, undefined, undefined, { cwd: root });
  assert.equal(overview.content[0].text, `${root} is a CMake project, but ${reason}, so the project model is unavailable. To enable it, ${steps}.`);
  assert.equal(overview.isError, true);
  assert.deepEqual(executed, []);
});
