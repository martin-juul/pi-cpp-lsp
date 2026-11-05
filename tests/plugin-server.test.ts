import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Exec, ExecOptions, ExecResult } from "../packages/core/src/exec.ts";
import { projectCacheDir, readProjectState } from "../packages/core/src/project/root.ts";
import { STANDARD_GUIDELINE } from "../packages/core/src/session.ts";
import { cppTools } from "../packages/core/src/tools.ts";
import { CppPlugin, createServer, type PluginOptions } from "../plugins/cpp-lsp/src/server.ts";
import { addTrusted, trustFile } from "../plugins/cpp-lsp/src/trust.ts";

// Feature probes and caches stay private to this file, so test files running at the same time
// never count or reuse each other's.
process.env.TMPDIR = mkdtempSync(join(tmpdir(), "cpp-lsp-plugin-tmp-"));

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "cmake");
const mockClangd = resolve(here, "fixtures", "mock-clangd.mjs");
const hasCmake = spawnSync("cmake", ["--version"]).status === 0;

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

const missing: ExecResult = { stdout: "", stderr: "not found", code: 127, killed: false };

/**
 * Real programs, except a clang-format that reports success without touching the file and a
 * `claude` that answers `claude` (missing by default). Records every command but `claude`.
 */
function recordingExec(options: { claude?: ExecResult; compiler?: Exec } = {}) {
  const calls: string[] = [];
  const exec: Exec = async (command, args, execOptions) => {
    if (command === "claude") return options.claude ?? missing;
    calls.push(command);
    if (command === "clang-format") return { stdout: "", stderr: "", code: 0, killed: false };
    return (await options.compiler?.(command, args, execOptions)) ?? nodeExec(command, args, execOptions);
  };
  return { calls, exec };
}

const mock = (...features: string[]) => ({ command: process.execPath, args: [mockClangd, `--mock-features=${features.join(",")}`], timeoutMs: 5000 });

function freshCache(): string {
  const cache = mkdtempSync(join(tmpdir(), "cpp-lsp-plugin-cache-"));
  process.env.XDG_CACHE_HOME = cache;
  return cache;
}

function copyFixture(name: string): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "cpp-lsp-plugin-"))), name);
  cpSync(join(fixtures, name), root, { recursive: true });
  return root;
}

/** A CMake project that no test configures. */
function untrustedProject(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cpp-lsp-untrusted-")));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.14)\nproject(untrusted CXX)\nadd_executable(app src/main.cpp)\n");
  writeFileSync(join(root, "src", "main.cpp"), "int main() { return 0; }\n");
  return root;
}

const dataDir = () => mkdtempSync(join(tmpdir(), "cpp-lsp-plugin-data-"));

/** A plugin and an MCP client connected to its server in memory. */
async function connect(t: any, options: Partial<PluginOptions> & Pick<PluginOptions, "projectDir" | "exec">) {
  const plugin = new CppPlugin({
    waitMs: 60_000, clangd: mock(), toolchain: { clangd: mock(), clangdTimeoutMs: 5000 },
    diagnostics: { waitMs: 5000, firstOpenWaitMs: 10_000 }, ...options,
  });
  const server = await createServer(plugin);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  t.after(async () => { await client.close(); await plugin.dispose(); });
  return {
    plugin,
    client,
    /** Calls a hook tool and returns the context it adds, or undefined when it adds nothing. */
    async hook(name: string, args: Record<string, unknown> = {}, event?: string): Promise<string | undefined> {
      const result = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
      assert.equal(result.isError, undefined);
      const text = result.content[0]!.text;
      if (!text) return undefined;
      const output = JSON.parse(text).hookSpecificOutput;
      if (event) assert.equal(output.hookEventName, event);
      return output.additionalContext;
    },
    async call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
      return { text: result.content.map(part => part.text).join("\n"), isError: result.isError === true };
    },
  };
}

/** Waits for the first configure and the feature check, so later prompts carry no feature update. */
async function settled(plugin: CppPlugin): Promise<void> {
  const session = plugin.current();
  await session.project.ready();
  const deadline = Date.now() + 120_000;
  while (session.project.status === "configuring") {
    if (Date.now() > deadline) throw new Error("configure did not finish");
    await new Promise(done => setTimeout(done, 50));
  }
  await session.toolchain.settled();
}

const TOOLS_2_0_0 = [
  "cpp_build", "cpp_test", "cpp_run", "cpp_project", "cpp_hover", "cpp_definition", "cpp_references", "cpp_symbols",
  "cpp_calls", "cpp_types", "cpp_rename", "cpp_check", "cpp_compile", "cpp_format", "cpp_gen_compdb",
];
const HOOK_TOOLS = ["cpp_hook_prompt", "cpp_hook_post_edit", "cpp_hook_after_shell", "cpp_hook_session_start"];

test("tools/list offers every 2.0.0 tool with its schema, then cpp_preset and the hook tools", async t => {
  freshCache();
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "cpp-lsp-plain-")));
  const s = await connect(t, { projectDir, exec: recordingExec().exec });
  const { tools } = await s.client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), [...TOOLS_2_0_0, "cpp_preset", ...HOOK_TOOLS]);
  const specs = cppTools(() => undefined, { exec: nodeExec }).specs;
  for (const spec of specs) {
    const tool = tools.find(candidate => candidate.name === spec.name)!;
    assert.deepEqual(tool.inputSchema, JSON.parse(JSON.stringify(spec.parameters)), spec.name);
    assert.ok(tool.description!.startsWith(`${spec.description}\n\n${spec.promptSnippet}`), spec.name);
    for (const guideline of spec.promptGuidelines ?? []) assert.ok(tool.description!.includes(guideline), spec.name);
  }
  for (const name of HOOK_TOOLS) assert.match(tools.find(tool => tool.name === name)!.description!, /not for direct use/);
});

test("in a CMake project the user has not enabled, the first prompt carries one line, no tool runs anything, and a cleared conversation hears it again", async t => {
  freshCache();
  const root = untrustedProject();
  const { calls, exec } = recordingExec();
  const s = await connect(t, { projectDir: root, dataDir: dataDir(), exec });
  const instructions = s.client.getInstructions()!;
  assert.ok(instructions.startsWith(`${STANDARD_GUIDELINE}\n`), instructions);
  assert.doesNotMatch(instructions, /compile_commands\.json exists/);

  const first = await s.hook("cpp_hook_prompt", {}, "UserPromptSubmit");
  assert.equal(first, `cpp-lsp: ${root} is a CMake project, but the cpp-lsp plugin is not enabled for it, and configuring it would run the project's CMake code. Project briefing and drift detection are off until you enable the plugin here; to enable them, run /cpp-lsp:trust.`);
  assert.equal(await s.hook("cpp_hook_prompt"), undefined);

  const position = { file: "src/main.cpp", line: 1, column: 5 };
  for (const [name, args] of [
    ["cpp_references", position], ["cpp_build", {}], ["cpp_compile", { file: "src/main.cpp" }], ["cpp_gen_compdb", {}],
    ["cpp_hover", position], ["cpp_definition", position], ["cpp_project", { action: "overview" }], ["cpp_preset", {}],
  ] as const) {
    const result = await s.call(name, args);
    assert.equal(result.isError, true, name);
    assert.match(result.text, /is a CMake project, but the cpp-lsp plugin is not enabled for it.*Nothing ran\. Ask the user to enable it with \/cpp-lsp:trust\.$/, name);
  }
  // The plugin stays inactive after edits and shell commands too: no formatting, no clangd.
  assert.equal(await s.hook("cpp_hook_post_edit", { file_path: join(root, "src", "main.cpp") }), undefined);
  assert.equal(await s.hook("cpp_hook_after_shell"), undefined);
  assert.deepEqual(calls, [], "nothing ran");

  assert.equal(await s.hook("cpp_hook_session_start", { source: "clear" }), undefined);
  assert.equal(await s.hook("cpp_hook_prompt"), first);
  assert.equal(await s.hook("cpp_hook_prompt"), undefined);
  assert.deepEqual(readdirSync(root).sort(), ["CMakeLists.txt", "src"]);
});

/** Every program but `claude` fails to start, so a configure fails at once and nothing real runs. */
const nothingRuns = () => recordingExec({ compiler: async () => missing });

test("a CMake project that appears mid-session needs enabling before anything runs in it", async t => {
  freshCache();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cpp-lsp-clone-")));
  const data = dataDir();
  const { calls, exec } = nothingRuns();
  const s = await connect(t, { projectDir: root, dataDir: data, exec });
  assert.equal(s.plugin.root, undefined);
  await s.hook("cpp_hook_prompt");

  // A clone into the project directory brings the CMake project in.
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.14)\nproject(cloned CXX)\nadd_executable(app src/main.cpp)\n");
  writeFileSync(join(root, "src", "main.cpp"), "int main() { return 0; }\n");
  calls.length = 0;
  for (const name of ["cpp_gen_compdb", "cpp_build", "cpp_test"]) {
    const result = await s.call(name);
    assert.equal(result.isError, true, name);
    assert.match(result.text, /is a CMake project, but the cpp-lsp plugin is not enabled for it.*Nothing ran\./, name);
  }
  assert.deepEqual(calls, [], "nothing ran");
  assert.equal(s.plugin.root, root);
  assert.match((await s.hook("cpp_hook_prompt"))!, new RegExp(`^cpp-lsp: ${root} is a CMake project, .*run /cpp-lsp:trust\\.$`));

  addTrusted(data, root);
  assert.ok(s.plugin.activeSession(), "enabling the new project takes effect in the running session");
});

test("disabling the project mid-session closes the gate again", async t => {
  freshCache();
  const root = untrustedProject();
  const data = dataDir();
  addTrusted(data, root);
  const { calls, exec } = nothingRuns();
  const s = await connect(t, { projectDir: root, dataDir: data, exec });
  assert.doesNotMatch((await s.call("cpp_project", { action: "overview" })).text, /not enabled/);

  writeFileSync(trustFile(data), "[]\n");
  calls.length = 0;
  const result = await s.call("cpp_build");
  assert.equal(result.isError, true);
  assert.match(result.text, /is a CMake project, but the cpp-lsp plugin is not enabled for it/);
  assert.deepEqual(calls, [], "nothing ran");
  assert.match((await s.hook("cpp_hook_prompt"))!, /run \/cpp-lsp:trust\.$/);
});

test("an unknown tool and invalid arguments are errors the model can read", async t => {
  freshCache();
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "cpp-lsp-plain-")));
  const s = await connect(t, { projectDir, exec: nothingRuns().exec });
  assert.deepEqual(await s.call("cpp_nope"), { text: "Unknown tool: cpp_nope", isError: true });
  const invalid = await s.call("cpp_hover", { file: "main.cpp" });
  assert.equal(invalid.isError, true);
  assert.match(invalid.text, /^Invalid arguments for cpp_hover:\n  - /);
});

test("the trusted multi project: briefing once, the post-edit note, drift after a shell command, and the briefing again after compact and clear", { skip: !hasCmake }, async t => {
  const cache = freshCache();
  const root = copyFixture("multi");
  const data = dataDir();
  addTrusted(data, root);
  const before = readdirSync(root).sort();
  const s = await connect(t, { projectDir: root, dataDir: data, exec: recordingExec().exec });
  await settled(s.plugin);

  const instructions = s.client.getInstructions()!;
  assert.ok(instructions.startsWith(`${STANDARD_GUIDELINE}\n`), instructions);
  for (const name of TOOLS_2_0_0) assert.ok(instructions.includes(name), name);

  const briefing = await s.hook("cpp_hook_prompt", {}, "UserPromptSubmit");
  assert.match(briefing!, /^# C\+\+ project briefing \(CMake\)/);
  assert.match(briefing!, /\| legacy \| library \| libs\/legacy \| C\+\+14 \|/);
  assert.match(briefing!, /## C\+\+ features/);
  assert.equal(await s.hook("cpp_hook_prompt"), undefined);

  const legacy = join(root, "libs", "legacy", "legacy.cpp");
  writeFileSync(legacy, '#include "legacy.h"\nint legacy_value() { return shared_value(); }\n');
  const note = await s.hook("cpp_hook_post_edit", { file_path: legacy }, "PostToolUse");
  assert.equal(note, "[cpp-lsp] Formatted with clang-format ✓\nowner legacy (C++14)\ndiagnostics: no problems");

  writeFileSync(join(root, "libs", "legacy", "newer.cpp"), "int newer_value() { return 3; }\n");
  const drift = await s.hook("cpp_hook_after_shell", {}, "PostToolUse");
  assert.match(drift!, /^\[cpp-lsp\] New: libs\/legacy\/newer\.cpp.*no target/);
  assert.equal(await s.hook("cpp_hook_after_shell"), undefined);

  assert.equal(await s.hook("cpp_hook_session_start", { source: "startup" }), undefined);
  assert.equal(await s.hook("cpp_hook_prompt"), undefined, "startup needs no second briefing");
  for (const source of ["compact", "clear"]) {
    assert.equal(await s.hook("cpp_hook_session_start", { source }), undefined);
    assert.match((await s.hook("cpp_hook_prompt"))!, /^# C\+\+ project briefing/, source);
    assert.equal(await s.hook("cpp_hook_prompt"), undefined, source);
  }

  // The managed build, the index and the log live in the plugin's own cache, never pi's or the project's.
  assert.ok(projectCacheDir(root).startsWith(join(cache, "cpp-lsp-claude") + "/"));
  assert.ok(existsSync(join(projectCacheDir(root), "builds", "default", "compile_commands.json")));
  assert.ok(!existsSync(join(cache, "pi-cpp-lsp")));
  assert.deepEqual(readdirSync(root).sort(), before);
});

test("enabling the project mid-session brings the briefing with the next prompt, and a new session starts enabled", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("multi");
  const data = dataDir();
  const s = await connect(t, { projectDir: root, dataDir: data, exec: recordingExec().exec });
  assert.match((await s.hook("cpp_hook_prompt"))!, /run \/cpp-lsp:trust\.$/);
  assert.equal((await s.call("cpp_project", { action: "overview" })).isError, true);

  addTrusted(data, root);
  const briefing = await s.hook("cpp_hook_prompt", {}, "UserPromptSubmit");
  assert.match(briefing!, /^# C\+\+ project briefing \(CMake\)/);
  assert.doesNotMatch(briefing!, /cpp-lsp:trust/);
  const overview = await s.call("cpp_project", { action: "overview" });
  assert.equal(overview.isError, false);
  assert.match(overview.text, /\| app \| executable \|/);

  const next = await connect(t, { projectDir: root, dataDir: data, exec: recordingExec().exec });
  const again = await next.hook("cpp_hook_prompt", {}, "UserPromptSubmit");
  assert.match(again!, /^# C\+\+ project briefing \(CMake\)/);
});

// Macro dumps as GCC 16 prints them for `-std=c++26` (trimmed to what the catalog reads).
const GCC16 = [
  "#define __GNUC__ 16", "#define __cpp_contracts 202502L", "#define __cpp_pack_indexing 202311L", "#define __cpp_pp_embed 202502L",
  "#define __cpp_placeholder_variables 202306L", "#define __cpp_deleted_function 202403L", "#define __cpp_structured_bindings 202411L",
].join("\n");
const GCC16_REFLECTION = `${GCC16}\n#define __cpp_impl_reflection 202603L\n#define __cpp_lib_reflection 202603L`;

test("in a C++26 reflection target whose errors only clangd reports, the post-edit note carries the build compiler's verdict", { skip: !hasCmake }, async t => {
  freshCache();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cpp-lsp-gap-")));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "CMakeLists.txt"), [
    "cmake_minimum_required(VERSION 3.14)", "project(gap CXX)", "add_executable(app src/main.cpp)",
    "set_target_properties(app PROPERTIES CXX_STANDARD 26)", "target_compile_options(app PRIVATE -freflection)", "",
  ].join("\n"));
  writeFileSync(join(root, "src", "main.cpp"), "int main() { return 0; }\n");
  const data = dataDir();
  addTrusted(data, root);
  // The compile commands name g++, which the profile is named after; CMake picks it from CXX.
  const previousCxx = process.env.CXX;
  process.env.CXX = "g++";
  t.after(() => { if (previousCxx === undefined) delete process.env.CXX; else process.env.CXX = previousCxx; });

  // The build compiler reads as GCC 16 with reflection, and finds the file clean.
  const checks: string[][] = [];
  const compiler: Exec = async (_command, args) => {
    if (args.includes("-dM")) return { stdout: args.includes("-freflection") ? GCC16_REFLECTION : GCC16, stderr: "", code: 0, killed: false };
    if (args.includes("-fsyntax-only")) { checks.push(args); return { stdout: "", stderr: "", code: 0, killed: false }; }
    return undefined as unknown as ExecResult;
  };
  const { exec } = recordingExec({ compiler });
  // clangd knows only pack indexing, so it lacks what the target uses.
  const s = await connect(t, { projectDir: root, dataDir: data, exec, toolchain: { clangd: mock("pack_indexing"), clangdTimeoutMs: 5000 } });
  await settled(s.plugin);
  const profile = s.plugin.current().toolchain.gapProfileFor(join(root, "src", "main.cpp"));
  assert.equal(profile?.compiler, "g++ 16");

  // The mock clangd reports an error in any file that mentions DIAG.
  const file = join(root, "src", "main.cpp");
  writeFileSync(file, "// DIAG: clangd lacks this\nint main() { return 0; }\n");
  const note = await s.hook("cpp_hook_post_edit", { file_path: file }, "PostToolUse");
  assert.match(note!, /diagnostics: no problems\nchecked by g\+\+ 16$/);
  assert.doesNotMatch(note!, /mock error/);
  assert.equal(checks.length, 1);
  assert.ok(checks[0]!.includes("-freflection"), "the check compiles with the target's own flags");
});

test("with Claude Code's clangd-lsp plugin enabled, the log says once that its diagnostics bypass the compiler check", async t => {
  freshCache();
  const root = untrustedProject();
  const listing = JSON.stringify([
    { id: "vercel@claude-plugins-official", enabled: true },
    { id: "clangd-lsp@claude-plugins-official", version: "1.0.0", scope: "user", enabled: true },
  ]);
  const s = await connect(t, { projectDir: root, dataDir: dataDir(), exec: recordingExec({ claude: { stdout: listing, stderr: "", code: 0, killed: false } }).exec });
  await s.plugin.coexistence;
  const log = readFileSync(join(projectCacheDir(root), "cpp-lsp.log"), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  assert.match(log[0]!, /clangd-lsp plugin is enabled as well: its clangd diagnostics reach Claude directly, without the build compiler's check/);
  assert.doesNotMatch((await s.hook("cpp_hook_prompt"))!, /clangd-lsp/);

  for (const claude of [
    missing,
    { stdout: JSON.stringify([{ id: "clangd-lsp@claude-plugins-official", enabled: false }]), stderr: "", code: 0, killed: false },
    { stdout: "not json", stderr: "", code: 0, killed: false },
    { stdout: "", stderr: "", code: 1, killed: true },
  ]) {
    freshCache();
    const quiet = await connect(t, { projectDir: untrustedProject(), dataDir: dataDir(), exec: recordingExec({ claude }).exec });
    await quiet.plugin.coexistence;
    assert.ok(!existsSync(join(projectCacheDir(quiet.plugin.root!), "cpp-lsp.log")), JSON.stringify(claude));
  }
});

test("cpp_preset lists the presets and switches to one with a reconfigure, in the plugin's words", { skip: !hasCmake }, async t => {
  freshCache();
  const root = copyFixture("presets");
  const data = dataDir();
  addTrusted(data, root);
  const s = await connect(t, { projectDir: root, dataDir: data, exec: recordingExec().exec });
  await settled(s.plugin);

  const listed = await s.call("cpp_preset");
  assert.equal(listed.isError, false);
  assert.match(listed.text, /^cpp-lsp: configure presets for /);
  assert.match(listed.text, /^\s+debug \(active, default\)$/m);
  assert.match(listed.text, /^Switch with \/cpp-lsp:cpp-preset <name>\.$/m);
  const project = await s.call("cpp_project", { action: "presets" });
  assert.match(project.text, /Only the user can switch presets, with the \/cpp-lsp:cpp-preset <name> command/);

  const switched = await s.call("cpp_preset", { name: "release" });
  assert.equal(switched.isError, false, switched.text);
  assert.match(switched.text, /^cpp-lsp: using preset release for .*; reconfiguring\.\ncpp-lsp: CMake configure with preset release succeeded\.$/);
  assert.equal(readProjectState(root).preset, "release");
  assert.match((await s.hook("cpp_hook_prompt"))!, /Preset: release/);
});

test("the plugin's hooks call its own server's hook tools, and its manifest names that server", async t => {
  const plugin = resolve(here, "..", "plugins", "cpp-lsp");
  const read = (path: string) => JSON.parse(readFileSync(join(plugin, path), "utf8"));
  const name = read(".claude-plugin/plugin.json").name;
  const servers = Object.keys(read(".mcp.json").mcpServers);
  assert.deepEqual(servers, ["core"]);
  const wiring: string[] = [];
  for (const [event, groups] of Object.entries(read("hooks/hooks.json").hooks as Record<string, { matcher?: string; hooks: { server: string; tool: string; input: object }[] }[]>)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        assert.equal(hook.server, `plugin:${name}:core`);
        wiring.push(`${event} ${group.matcher ?? "*"} ${hook.tool} ${JSON.stringify(hook.input)}`);
      }
    }
  }
  assert.deepEqual(wiring, [
    "UserPromptSubmit * cpp_hook_prompt {}",
    'PostToolUse Write|Edit|MultiEdit cpp_hook_post_edit {"file_path":"${tool_input.file_path}"}',
    "PostToolUse Bash cpp_hook_after_shell {}",
    // mcp_tool hooks cannot run at startup, before the server is connected, and report an error there.
    'SessionStart clear|compact|resume cpp_hook_session_start {"source":"${source}"}',
  ]);
  freshCache();
  const s = await connect(t, { projectDir: realpathSync(mkdtempSync(join(tmpdir(), "cpp-lsp-plain-"))), exec: recordingExec().exec });
  const { tools } = await s.client.listTools();
  for (const tool of new Set(wiring.map(line => line.split(" ")[2]))) assert.ok(tools.some(candidate => candidate.name === tool), tool);
});

test("the committed server bundle serves the tools over stdio and exits when Claude Code closes it", async () => {
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "cpp-lsp-stdio-")));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(here, "..", "plugins", "cpp-lsp", "server", "server.mjs")],
    env: { ...process.env as Record<string, string>, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir() },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), [...TOOLS_2_0_0, "cpp_preset", ...HOOK_TOOLS]);
  assert.match(client.getInstructions()!, /C\/C\+\+ tools from the cpp-lsp plugin/);
  const pid = transport.pid!;
  await client.close();
  const deadline = Date.now() + 10_000;
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  while (alive() && Date.now() < deadline) await new Promise(done => setTimeout(done, 50));
  assert.ok(!alive(), "the server exited");
});
