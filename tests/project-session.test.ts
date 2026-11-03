import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExecOptions, ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/index.ts";
import type { Exec } from "../extensions/lib/project/configure.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "cmake");
const hasCmake = spawnSync("cmake", ["--version"]).status === 0;
const hasGit = spawnSync("git", ["--version"]).status === 0;
const hasClang = spawnSync("clang++", ["--version"]).status === 0;
const FIXED_GUIDELINES = [
  "Prefer smart pointers over raw new/delete in C++ code.",
  "Ensure compile_commands.json exists for proper clangd support.",
  "Use minimal diffs when editing C/C++ files.",
];

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

/**
 * Holds every `cmake -S` configure at a gate while `closed`, like a slow configure. Aborting the
 * signal releases a held run as killed. `finished` resolves when the held run's real cmake exits.
 */
function gatedExec() {
  let open: () => void = () => {};
  let gate: Promise<void> | undefined;
  const state = {
    closed: false,
    signals: [] as AbortSignal[],
    finished: Promise.resolve() as Promise<unknown>,
    close() { state.closed = true; gate = new Promise(resolve => { open = resolve; }); },
    open() { state.closed = false; open(); },
    exec: (async (command, args, options = {}) => {
      if (command !== "cmake" || args[0] !== "-S" || !state.closed) return nodeExec(command, args, options);
      if (options.signal) state.signals.push(options.signal);
      const run = (async () => {
        const aborted = new Promise<"aborted">(resolve => {
          if (options.signal?.aborted) resolve("aborted");
          options.signal?.addEventListener("abort", () => resolve("aborted"), { once: true });
        });
        if (await Promise.race([gate!.then(() => "open" as const), aborted]) === "aborted") return { stdout: "", stderr: "", code: 1, killed: true };
        return nodeExec(command, args, options);
      })();
      state.finished = run;
      return run;
    }) as Exec,
  };
  return state;
}

function freshCache(): void {
  process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "pi-cpp-cache-"));
}

function copyFixture(name: string): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-session-"))), name);
  cpSync(join(fixtures, name), root, { recursive: true });
  return root;
}

function write(root: string, path: string, text = "int added() { return 0; }\n"): string {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  return join(root, path);
}

function git(root: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

interface RunMessage { customType: string; content: string; display: boolean }

/** Drive the real extension entry point through a fake ExtensionAPI. */
async function session(t: any, cwd: string, options: { exec?: Exec; waitMs?: number; start?: boolean; trusted?: boolean } = {}) {
  const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
  const tools = new Map<string, any>();
  const notifications: string[] = [];
  const api = {
    exec: options.exec ?? nodeExec,
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand() {},
    on(name: string, handler: any) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
  };
  extension(api as unknown as ExtensionAPI, { project: { waitMs: options.waitMs ?? 20_000 } });
  const ctx = { cwd, isProjectTrusted: () => options.trusted ?? true, ui: { notify: (message: string) => notifications.push(message) } };
  const emit = async (name: string, event: any) => {
    let last: unknown;
    for (const handler of handlers.get(name) ?? []) {
      const value = await handler({ type: name, ...event }, ctx);
      if (value !== undefined) last = value;
    }
    return last as any;
  };
  let closed = false;
  const shutdown = async () => { if (!closed) { closed = true; await emit("session_shutdown", { reason: "quit" }); } };
  t.after(shutdown);
  if (options.start !== false) await emit("session_start", { reason: "startup" });
  return {
    tools, notifications, emit, shutdown,
    async run(event: any = { messageType: "user", prompt: "hi" }) {
      const systemPromptOptions = { promptGuidelines: ["Existing guideline."] };
      const result = await emit("before_agent_start", { systemPrompt: "", systemPromptOptions, ...event });
      return { message: result?.message as RunMessage | undefined, guidelines: systemPromptOptions.promptGuidelines };
    },
    /** The text a tool_result handler appended, or undefined when the result is unchanged. */
    async toolResult(toolName: string, input: Record<string, unknown>, isError = false) {
      const content = [{ type: "text", text: "original" }];
      const result = await emit("tool_result", { toolName, toolCallId: "call", input, content, isError, details: undefined });
      if (!result?.content) return undefined;
      assert.deepEqual(result.content[0], content[0]);
      return result.content.slice(1).map((part: any) => part.text).join("");
    },
  };
}

test("a fresh session on the multi fixture gets the full briefing on its first run, then nothing new", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("multi");
  write(root, "libs/legacy/new.cpp");
  const s = await session(t, root);
  const first = await s.run();
  assert.equal(first.message?.customType, "cpp-project-briefing");
  const text = first.message!.content;
  assert.match(text, /\| legacy \| library \| libs\/legacy \| C\+\+14 \|/);
  assert.match(text, /\| app \| executable \| app, libs\/legacy \| C\+\+20 \| legacy \|/);
  assert.match(text, /\| unit_tests \| test \| tests \|/);
  assert.match(text, /Preset: none/);
  assert.match(text, /Configuration: Debug/);
  assert.match(text, /libs\/legacy\/new\.cpp.*legacy.*libs\/legacy\/CMakeLists\.txt:1/);
  assert.deepEqual(first.guidelines.slice(0, 1), ["Existing guideline."]);
  for (const fixed of FIXED_GUIDELINES) assert.ok(!first.guidelines.includes(fixed), fixed);
  assert.ok(first.guidelines.some(line => /C\+\+ standard of the target that owns/.test(line)), first.guidelines.join("\n"));
  assert.deepEqual(s.notifications, []);

  const second = await s.run();
  assert.equal(second.message, undefined);
  assert.ok(second.guidelines.some(line => /C\+\+ standard of the target that owns/.test(line)));

  await s.emit("session_compact", { reason: "manual", fromExtension: false, willRetry: false });
  const afterCompact = await s.run();
  assert.equal(afterCompact.message?.customType, "cpp-project-briefing");
  assert.match(afterCompact.message!.content, /libs\/legacy\/new\.cpp/);
});

test("the briefing names the active preset", { skip: !hasCmake }, async t => {
  freshCache();
  const s = await session(t, copyFixture("presets"));
  const { message } = await s.run();
  assert.equal(message?.customType, "cpp-project-briefing");
  assert.match(message!.content, /Preset: debug/);
});

test("runs started by the extension's own custom messages are skipped", { skip: !hasCmake }, async t => {
  freshCache();
  const s = await session(t, copyFixture("basic"));
  const custom = await s.run({ messageType: "custom", message: { role: "custom", customType: "cpp-project-update", content: "x", display: true, timestamp: 0 } });
  assert.equal(custom.message, undefined);
  assert.ok(custom.guidelines.some(line => /C\+\+ standard of the target that owns/.test(line)));
  assert.equal((await s.run()).message?.customType, "cpp-project-briefing");
});

test("a configure failure yields a briefing with CMake's error and the other tools still work", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("broken");
  const source = write(root, "check.cpp", "int main() { return 0; }\n");
  const s = await session(t, root);
  const { message } = await s.run();
  assert.equal(message?.customType, "cpp-project-briefing");
  assert.match(message!.content, /CMake configure failed/);
  assert.match(message!.content, /CMake Error at .*CMakeLists\.txt:3 \(find_package\)/);
  assert.match(message!.content, /DoesNotExist/);
  for (const name of ["cpp_build", "cpp_check", "cpp_compile", "cpp_definition", "cpp_format", "cpp_gen_compdb", "cpp_hover", "cpp_test"]) {
    assert.ok(s.tools.has(name), name);
  }
  if (hasClang) {
    const compiled = await s.tools.get("cpp_compile").execute("call", { file: source }, undefined, undefined, { cwd: root });
    assert.equal(compiled.isError, false, compiled.content[0].text);
  }
});

test("a missing listed source fails configure and appears in the briefing with its line", { skip: !hasCmake }, async t => {
  freshCache();
  const s = await session(t, copyFixture("missing-source"));
  const { message } = await s.run();
  assert.match(message!.content, /CMake configure failed/);
  assert.match(message!.content, /gone\.cpp.*missing.*CMakeLists\.txt:3/i);
});

test("a non-CMake directory gets no briefing, no drift output and the fixed guidelines", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-plain-")));
  const source = write(root, "main.cpp");
  const s = await session(t, root);
  const run = await s.run();
  assert.equal(run.message, undefined);
  assert.deepEqual(run.guidelines, ["Existing guideline.", ...FIXED_GUIDELINES]);
  assert.equal(await s.toolResult("bash", { command: "touch x.cpp" }), undefined);
  assert.equal(await s.toolResult("write", { path: join(root, "notes.txt") }), undefined);
  const formatted = await s.toolResult("write", { path: source });
  if (formatted !== undefined) assert.match(formatted, /Formatted with clang-format/);
  assert.deepEqual(s.notifications, []);
});

test("a CMake project without a usable cmake is a non-CMake session with a one-time notice", async t => {
  const noCmake: Exec = (command, args, options) => command === "cmake"
    ? Promise.resolve({ stdout: "", stderr: "cmake: not found", code: 127, killed: false })
    : nodeExec(command, args, options);
  const oldCmake: Exec = (command, args, options) => command === "cmake" && args[0] === "--version"
    ? Promise.resolve({ stdout: "cmake version 3.10.2\n", stderr: "", code: 0, killed: false })
    : nodeExec(command, args, options);
  for (const [exec, reason] of [[noCmake, /cmake was not found/i], [oldCmake, /3\.10\.2.*older than 3\.14/]] as const) {
    const root = copyFixture("basic");
    const s = await session(t, root, { exec });
    const first = await s.run();
    const second = await s.run();
    assert.equal(first.message, undefined);
    assert.equal(second.message, undefined);
    assert.deepEqual(first.guidelines, ["Existing guideline.", ...FIXED_GUIDELINES]);
    assert.equal(await s.toolResult("bash", { command: "true" }), undefined);
    assert.equal(s.notifications.length, 1, s.notifications.join("\n"));
    assert.match(s.notifications[0], reason);
  }
});

test("an untrusted CMake project runs no project commands and is a non-CMake session with a one-time trust note", async t => {
  freshCache();
  const root = copyFixture("basic");
  const commands: string[] = [];
  const exec: Exec = (command, args, options) => {
    commands.push([command, ...args].join(" "));
    return nodeExec(command, args, options);
  };
  const s = await session(t, root, { exec, trusted: false });
  const first = await s.run();
  const second = await s.run();
  assert.equal(first.message, undefined);
  assert.equal(second.message, undefined);
  assert.deepEqual(first.guidelines, ["Existing guideline.", ...FIXED_GUIDELINES]);
  assert.equal(await s.toolResult("bash", { command: "true" }), undefined);
  assert.equal(await s.toolResult("write", { path: join(root, "notes.txt") }), undefined);
  assert.deepEqual(commands.filter(command => /^(cmake|ctest|git|clangd)\b/.test(command)), []);
  assert.equal(s.notifications.length, 1, s.notifications.join("\n"));
  assert.match(s.notifications[0], /does not trust/);
  assert.match(s.notifications[0], /\/trust/);
  assert.match(s.notifications[0], /--approve/);
  const overview = await s.tools.get("cpp_project").execute("call", { action: "overview" }, undefined, undefined, { cwd: root });
  assert.equal(overview.isError, true);
  assert.match(overview.content[0].text, /does not trust/);
  assert.match(overview.content[0].text, /\/trust.*--approve/);
});

test("a bash git mv appends the drift deltas to the bash result", { skip: !hasCmake || !hasGit }, async t => {
  freshCache();
  const root = copyFixture("drift");
  git(root, "init", "-q");
  git(root, "add", "-A");
  const s = await session(t, root);
  assert.equal((await s.run()).message?.customType, "cpp-project-briefing");
  assert.equal(await s.toolResult("bash", { command: "true" }), undefined, "no new findings, no note");
  mkdirSync(join(root, "src/core"));
  git(root, "mv", "src/a.cpp", "src/core/a.cpp");
  const note = await s.toolResult("bash", { command: "git mv src/a.cpp src/core/a.cpp" });
  assert.ok(note, "bash result gets the drift delta");
  assert.match(note, /src\/core\/a\.cpp.*no target/);
  assert.match(note, /src\/a\.cpp.*missing.*CMakeLists\.txt:6/i);
  assert.equal(await s.toolResult("bash", { command: "true" }), undefined, "the same findings are not reported twice");
  const later = await s.run();
  assert.equal(later.message, undefined, "a later run with no new findings adds no message");
});

test("editing CMakeLists.txt reconfigures and reports the finding resolved, or the CMake error", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("drift");
  const s = await session(t, root);
  await s.run();
  const socket = write(root, "src/net/socket.cpp");
  const added = await s.toolResult("write", { path: socket });
  assert.match(added!, /src\/net\/socket\.cpp.*no target.*net.*src\/net\/CMakeLists\.txt:2/);

  const lists = join(root, "src/net/CMakeLists.txt");
  writeFileSync(lists, readFileSync(lists, "utf8").replace("connection.cpp", "connection.cpp socket.cpp"));
  const resolved = await s.toolResult("edit", { path: lists });
  assert.match(resolved!, /Resolved: src\/net\/socket\.cpp/);
  assert.match(resolved!, /net/);

  writeFileSync(lists, "add_library(net STATIC\n");
  const broken = await s.toolResult("edit", { path: lists });
  assert.match(broken!, /CMake configure failed/);
  assert.match(broken!, /CMake Error/);

  const delta = await s.run();
  assert.equal(delta.message, undefined, "the configure error is reported once");
});

test("a file picked up by file(GLOB) is confirmed after a reconfigure", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("glob");
  const s = await session(t, root);
  await s.run();
  const created = write(root, "src/extra/new.cpp");
  const note = await s.toolResult("write", { path: created });
  assert.match(note!, /src\/extra\/new\.cpp/);
  assert.match(note!, /no CMake edit is needed/i);
  assert.match(note!, /now part of globbed/);
});

test("a configure slower than the wait gets the loading message first, the briefing next", { skip: !hasCmake }, async t => {
  freshCache();
  const gated = gatedExec();
  gated.close();
  const s = await session(t, copyFixture("basic"), { exec: gated.exec, waitMs: 300 });
  const started = Date.now();
  const first = await s.run();
  assert.ok(Date.now() - started < 3000);
  assert.equal(first.message?.customType, "cpp-project-loading");
  assert.match(first.message!.content, /loading/i);
  gated.open();
  await gated.finished;
  const second = await s.run();
  assert.equal(second.message?.customType, "cpp-project-briefing");
  assert.match(second.message!.content, /\| app \| executable \|/);
});

test("a write during a slow reconfigure returns within the bound, and the outcome follows", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("drift");
  const gated = gatedExec();
  const s = await session(t, root, { exec: gated.exec, waitMs: 400 });
  await s.run();
  const socket = write(root, "src/net/socket.cpp");
  assert.match((await s.toolResult("write", { path: socket }))!, /socket\.cpp.*no target/);

  gated.close();
  const lists = join(root, "src/net/CMakeLists.txt");
  writeFileSync(lists, readFileSync(lists, "utf8").replace("connection.cpp", "connection.cpp socket.cpp"));
  const started = Date.now();
  const pending = await s.toolResult("edit", { path: lists });
  assert.ok(Date.now() - started < 3000);
  assert.match(pending!, /reconfiguring; drift results follow/);

  gated.open();
  await gated.finished;
  const followUp = await s.toolResult("bash", { command: "true" });
  assert.match(followUp!, /Resolved: src\/net\/socket\.cpp/);
});

test("a configure reused from another session does not hide this session's CMake edit made during it", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("drift");
  // Session A's configure runs cmake, then keeps the lock while the gate is closed.
  let release: () => void = () => {};
  let held: () => void = () => {};
  const holdStarted = new Promise<void>(resolve => { held = resolve; });
  let holding = false;
  const holdAfter: Exec = async (command, args, options) => {
    const result = await nodeExec(command, args, options);
    if (command === "cmake" && args[0] === "-S" && holding) {
      await new Promise<void>(resolve => { release = resolve; held(); });
    }
    return result;
  };
  const runsB: string[][] = [];
  const countedB: Exec = (command, args, options) => {
    if (command === "cmake" && args[0] === "-S") runsB.push(args);
    return nodeExec(command, args, options);
  };
  const a = await session(t, root, { exec: holdAfter, waitMs: 5_000 });
  await a.run();
  const b = await session(t, root, { exec: countedB, waitMs: 5_000 });
  await b.run();

  holding = true;
  const top = join(root, "CMakeLists.txt");
  writeFileSync(top, readFileSync(top, "utf8"));
  const aPending = a.toolResult("edit", { path: top });
  await holdStarted;

  // B edits CMakeLists.txt after A's configure read it; B's report point waits on A's lock and reuses A's replies.
  write(root, "src/net/socket.cpp");
  const lists = join(root, "src/net/CMakeLists.txt");
  writeFileSync(lists, readFileSync(lists, "utf8").replace("connection.cpp", "connection.cpp socket.cpp"));
  const runsBefore = runsB.length;
  const bEdit = b.toolResult("edit", { path: lists });
  await new Promise(resolve => setTimeout(resolve, 500));
  holding = false;
  release();
  await aPending;
  await bEdit;
  assert.equal(runsB.length, runsBefore, "B reused A's configure");

  // The next report point sees that B's edit is newer than the configure B reused.
  await b.toolResult("bash", { command: "true" });
  assert.equal(runsB.length, runsBefore + 1, "B reconfigures for its own edit");
  const owner = await b.tools.get("cpp_project").execute("call", { action: "owner", path: join(root, "src/net/socket.cpp") }, undefined, undefined, { cwd: root });
  assert.match(owner.content.map((part: any) => part.text).join(""), /is built by: net/);
});

test("session_shutdown during configure aborts it", { skip: !hasCmake }, async t => {
  freshCache();
  const gated = gatedExec();
  gated.close();
  const s = await session(t, copyFixture("basic"), { exec: gated.exec, waitMs: 300 });
  const deadline = Date.now() + 5000;
  while (gated.signals.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(gated.signals.length, 1, "configure started");
  assert.equal(gated.signals[0].aborted, false);
  await s.shutdown();
  assert.equal(gated.signals[0].aborted, true);
  await gated.finished;
});

test.after(() => {
  if (process.env.XDG_CACHE_HOME?.startsWith(tmpdir())) rmSync(process.env.XDG_CACHE_HOME, { recursive: true, force: true });
});
