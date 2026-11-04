import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, realpathSync } from "node:fs";
import type { ExecOptions, ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProjectService } from "../extensions/lib/project/session.ts";
import type { ProjectModel } from "../extensions/lib/project/model.ts";
import { registerClangdTools, type ClangdToolOptions } from "../extensions/lib/clangd.ts";
import { registerNavigationTools, type NavigationOptions } from "../extensions/lib/navigation.ts";
import type { TargetProfile } from "../extensions/lib/toolchain.ts";

const mock = resolve("tests/fixtures/mock-clangd.mjs");

/** The clangd and navigation tools on a fake ExtensionAPI, sharing one managed connection as index.ts wires them. */
function register(options: ClangdToolOptions, navigation?: NavigationOptions) {
  const tools = new Map<string, any>();
  const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
  const api = { registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]) };
  const managed = registerClangdTools(api as unknown as ExtensionAPI, options);
  registerNavigationTools(api as unknown as ExtensionAPI, managed, navigation);
  const emit = async (name: string, event: any = {}) => { for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, {}); };
  return { tools, managed, emit };
}

type Result = { text: string; isError: boolean; details: any };
function caller(tools: Map<string, any>, cwd: string) {
  return async (name: string, params: Record<string, unknown>): Promise<Result> => {
    const result = await tools.get(name).execute("call", params, undefined, undefined, { cwd });
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

// ---------------------------------------------------------------------------
// Mock clangd: index state, truncation, unsupported methods

/** A managed mock connection whose project model is ready from the start and whose first source is `text`. */
async function managedMock(t: any, text: string, navigation?: NavigationOptions) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-nav-mock-"));
  const source = join(cwd, "main.cpp");
  const buildDir = join(cwd, "managed");
  await writeFile(source, text);
  await mkdir(buildDir);
  await writeFile(join(buildDir, "compile_commands.json"), "[]");
  const model = { sourceRoot: cwd, buildDir, targets: [{ isProjectTarget: true, sources: [{ path: source, isGenerated: false, language: "CXX" }] }] } as unknown as ProjectModel;
  const project = { model, onModelChange: () => () => {} } as unknown as ProjectService;
  const registered = register({ command: process.execPath, args: [mock], timeoutMs: 1000, getProject: () => project }, navigation);
  t.after(async () => { await registered.emit("session_shutdown"); await rm(cwd, { recursive: true, force: true }); });
  await registered.emit("session_start");
  return { ...registered, cwd, source, call: caller(registered.tools, cwd) };
}

test("index-dependent results carry the incomplete note until the index is idle", async t => {
  const h = await managedMock(t, "REFS 2\nINDEX-BEGIN\n");
  const connection = (await h.managed.connection())!;
  await until(() => connection.indexState === "indexing");
  const building = await h.call("cpp_references", { file: "main.cpp", line: 1, column: 5 });
  assert.equal(building.isError, false, building.text);
  assert.match(building.text, new RegExp(`${h.source}:1:5\\n${h.source}:2:5`));
  assert.match(building.text, /index still building; results may be incomplete/);
  assert.equal(building.details.indexState, "indexing");

  await writeFile(h.source, "REFS 1\nINDEX-END\n");
  const idle = await h.call("cpp_references", { file: "main.cpp", line: 1, column: 5 });
  assert.equal(idle.details.indexState, "idle");
  assert.doesNotMatch(idle.text, /incomplete/);
});

test("an index that has not started counts as incomplete", async t => {
  const h = await managedMock(t, "REFS 1\n");
  const result = await h.call("cpp_references", { file: "main.cpp", line: 1, column: 5 });
  assert.match(result.text, /index not started; results may be incomplete/);
});

test("large result sets are truncated with a count of the omitted entries", async t => {
  const h = await managedMock(t, `REFS 250\n${"\n".repeat(250)}`);
  const result = await h.call("cpp_references", { file: "main.cpp", line: 1, column: 5 });
  assert.equal(result.details.locations.length, 100);
  assert.equal(result.details.omitted, 150);
  assert.equal(result.text.split("\n").filter(line => line.startsWith(h.source)).length, 100);
  assert.match(result.text, /150 more references omitted/);
});

test("a method this clangd lacks returns a not-supported message naming the version needed", async t => {
  const h = await managedMock(t, "int caller();\n");
  const result = await h.call("cpp_calls", { file: "main.cpp", line: 1, column: 5, direction: "outgoing" });
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /not supported by this clangd version/);
  assert.match(result.text, /outgoing calls need clangd 21 or newer/);
  assert.equal(result.details.supported, false);
});

test("without a managed project the tools explain that the CMake model is needed, and invalid input is rejected", async t => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-nav-none-"));
  await writeFile(join(cwd, "main.cpp"), "int x;\n");
  const registered = register({ command: process.execPath, args: [mock], timeoutMs: 1000, getProject: () => undefined });
  t.after(async () => { await registered.emit("session_shutdown"); await rm(cwd, { recursive: true, force: true }); });
  await registered.emit("session_start");
  const call = caller(registered.tools, cwd);
  const none = await call("cpp_references", { file: "main.cpp", line: 1, column: 5 });
  assert.equal(none.isError, true);
  assert.match(none.text, /CMake project model/);
  assert.match((await call("cpp_references", { file: "main.cpp", line: 9, column: 1 })).text, /outside the file/);
  const both = await call("cpp_symbols", { query: "x", file: "main.cpp" });
  assert.equal(both.isError, true);
  assert.match(both.text, /either query or file/);
});

/** A measured target whose build compiler supports `clangdLacks`, which clangd does not. */
function gapProfile(target: string, clangdLacks: string[]): TargetProfile {
  return { target, standard: 26, compiler: "g++ 16", family: "gcc", available: ["constexpr", ...clangdLacks], needsFlag: {}, clangdLacks, gap: true };
}

test("in a project with gap targets, navigation results end with a note naming the features clangd lacks, after the index note", async t => {
  const gaps = [gapProfile("app", ["reflection"]), gapProfile("core", ["contracts", "reflection"])];
  const h = await managedMock(t, "REFS 1\n", { gaps: () => gaps });
  const references = await h.call("cpp_references", { file: "main.cpp", line: 1, column: 5 });
  assert.equal(references.isError, false, references.text);
  const lines = references.text.split("\n");
  assert.equal(lines[0], `${h.source}:1:5`);
  assert.equal(lines[1], "[index not started; results may be incomplete]");
  assert.equal(lines[2], "[clangd lacks static reflection, contracts, which the build compiler supports; usages in code that uses them may be missing]");
  assert.equal(lines.length, 3);
});

test("without gap targets navigation output is unchanged", async t => {
  const expected = (source: string) => `${source}:1:5\n[index not started; results may be incomplete]`;
  const none = await managedMock(t, "REFS 1\n", { gaps: () => [] });
  assert.equal((await none.call("cpp_references", { file: "main.cpp", line: 1, column: 5 })).text, expected(none.source));
  const unwired = await managedMock(t, "REFS 1\n");
  assert.equal((await unwired.call("cpp_references", { file: "main.cpp", line: 1, column: 5 })).text, expected(unwired.source));
});

// ---------------------------------------------------------------------------
// Real clangd on the nav fixture

const clangdAvailable = spawnSync("clangd", ["--version"], { encoding: "utf8" }).status === 0;
const cmakeAvailable = spawnSync("cmake", ["--version"]).status === 0;
const clangdMajor = Number(/clangd version (\d+)/.exec(spawnSync("clangd", ["--version"], { encoding: "utf8" }).stdout ?? "")?.[1] ?? 0);

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

describe("real clangd navigation on the nav fixture", { skip: !(clangdAvailable && cmakeAvailable) }, () => {
  let root = "", scratch = "", previousCache: string | undefined;
  let project: ProjectService;
  let registered: ReturnType<typeof register>;
  let call: ReturnType<typeof caller>;
  const at = (file: string, line: number, column: number) => `${join(root, file)}:${line}:${column}`;

  before(async () => {
    previousCache = process.env.XDG_CACHE_HOME;
    scratch = realpathSync(await mkdtemp(join(tmpdir(), "pi-nav-project-")));
    process.env.XDG_CACHE_HOME = join(scratch, "cache");
    root = join(scratch, "nav");
    cpSync(resolve("tests/fixtures/cmake/nav"), root, { recursive: true });
    project = new ProjectService({ cwd: root, exec: nodeExec });
    registered = register({ timeoutMs: 30_000, getProject: () => project });
    call = caller(registered.tools, root);
    await registered.emit("session_start");
    await until(() => project.status === "ready", 60_000);
    const connection = (await registered.managed.connection())!;
    assert.equal(await connection.waitForIndexIdle(60_000), "idle");
  });
  after(async () => {
    await registered?.emit("session_shutdown");
    project?.dispose();
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previousCache;
    await rm(scratch, { recursive: true, force: true });
  });

  test("references to the shared function list the declaration, the definition and the three call sites", async () => {
    const result = await call("cpp_references", { file: "shared.h", line: 3, column: 5 });
    assert.equal(result.isError, false, result.text);
    for (const location of [at("shared.h", 3, 5), at("shared.cpp", 3, 5), at("alpha.cpp", 3, 26), at("beta.cpp", 3, 25), at("gamma.cpp", 3, 26)]) {
      assert.ok(result.text.split("\n").includes(location), `${location} in\n${result.text}`);
    }
    assert.equal(result.details.locations.length, 5);
  });

  test("symbol search finds the derived class with its file and line", async () => {
    const result = await call("cpp_symbols", { query: "Circle" });
    assert.equal(result.isError, false, result.text);
    assert.ok(result.text.split("\n").some(line => line.includes("Circle") && line.includes(at("shared.h", 16, 7))), result.text);
  });

  test("a file outline nests methods under their class", async () => {
    const result = await call("cpp_symbols", { file: "shared.h" });
    assert.equal(result.isError, false, result.text);
    const lines = result.text.split("\n");
    const circle = lines.findIndex(line => /^class Circle\b/.test(line));
    assert.ok(circle >= 0, result.text);
    assert.match(lines[circle]!, /16:7/);
    assert.ok(lines.slice(circle + 1).some(line => /^ {2}method radius\b.*20:10/.test(line)), result.text);
    assert.ok(lines.some(line => /^function shared_total\b.*3:5/.test(line)), result.text);
    assert.doesNotMatch(result.text, /incomplete/, "a file outline does not depend on the index");
  });

  test("incoming calls to the shared function return the three callers", async () => {
    const result = await call("cpp_calls", { file: "shared.h", line: 3, column: 5, direction: "incoming" });
    assert.equal(result.isError, false, result.text);
    for (const [name, file] of [["alpha_run", "alpha.cpp"], ["beta_run", "beta.cpp"], ["gamma_run", "gamma.cpp"]]) {
      assert.ok(result.text.split("\n").some(line => line.startsWith(at(file!, 3, 5)) && line.includes(name!)), `${name} in\n${result.text}`);
    }
    assert.equal(result.details.calls.length, 3);
  });

  test("outgoing calls from one caller return the shared function, or not supported before clangd 21", async () => {
    const result = await call("cpp_calls", { file: "alpha.cpp", line: 3, column: 5, direction: "outgoing" });
    assert.equal(result.isError, false, result.text);
    if (clangdMajor >= 21) {
      assert.ok(result.text.split("\n").some(line => line.startsWith(at("shared.cpp", 3, 5)) && line.includes("shared_total") && line.includes("3:26")), result.text);
    } else {
      assert.match(result.text, /not supported by this clangd version/);
    }
  });

  test("supertypes of the derived class return the base, and subtypes of the base return the derived class", async () => {
    const supertypes = await call("cpp_types", { file: "shared.h", line: 16, column: 7, direction: "supertypes" });
    assert.equal(supertypes.isError, false, supertypes.text);
    assert.ok(supertypes.text.split("\n").some(line => line.startsWith(at("shared.h", 9, 7)) && line.includes("Shape")), supertypes.text);
    const subtypes = await call("cpp_types", { file: "shared.h", line: 9, column: 7, direction: "subtypes" });
    assert.ok(subtypes.text.split("\n").some(line => line.startsWith(at("shared.h", 16, 7)) && line.includes("Circle")), subtypes.text);
  });

  test("a position with no symbol returns an empty, non-error result", async () => {
    for (const [name, extra] of [["cpp_references", {}], ["cpp_calls", { direction: "incoming" }], ["cpp_types", { direction: "subtypes" }]] as const) {
      const result = await call(name, { file: "shared.h", line: 2, column: 1, ...extra });
      assert.equal(result.isError, false, `${name}: ${result.text}`);
      assert.equal(result.details.found, false, name);
      assert.match(result.text, /^No /, name);
    }
  });
});
