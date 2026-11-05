import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findCompilationDatabase, loadCompilationDatabase, probeInvocation, resolveCompileInvocation, splitCommand, syntaxArguments } from "../packages/core/src/compdb.ts";

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "cpp-compdb-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "build"));
  mkdirSync(join(root, "src"));
  return root;
}

function database(root: string, entry: Record<string, unknown>) {
  writeFileSync(join(root, "build", "compile_commands.json"), JSON.stringify([entry]));
}

test("POSIX command quoting preserves spaces, empty args, backslashes and literal quoted macros", () => {
  assert.deepEqual(splitCommand(`clang++ -I"include dir" '-DNAME="some text"' '' a\\ b "a\\q"`),
    ["clang++", "-Iinclude dir", '-DNAME="some text"', "", "a b", "a\\q"]);
  for (const command of ["clang++ a.cpp && touch bad", "clang++ $(touch bad)", "clang++ `touch bad`", 'clang++ "$HOME/a.cpp"', "clang++ 'bad"]) {
    assert.throws(() => splitCommand(command), /unsupported|Unterminated/);
  }
});

test("standalone defaults distinguish C and C++ and allow explicit overrides", (t) => {
  const root = fixture(t);
  const c = resolveCompileInvocation(root, { file: "a.c" });
  assert.equal(c.compiler, "clang");
  assert.ok(c.args.includes("-std=c17"));
  const uppercase = resolveCompileInvocation(root, { file: "a.C" });
  assert.equal(uppercase.compiler, "clang++");
  assert.ok(uppercase.args.includes("-std=c++17"));
  const cpp = resolveCompileInvocation(root, { file: "a.cpp", compiler: "g++", standard: "c++23" });
  assert.equal(cpp.compiler, "g++");
  assert.ok(cpp.args.includes("-std=c++23"));
});

test("database arguments preserve project cwd and flags, replacing standard only when explicitly requested", (t) => {
  const root = fixture(t);
  const args = ["g++", "-I../include dir", "-DVALUE=42", "-std=c++20", "-c", "../src/a.cpp", "-o", "a.o", "-MD", "-MF", "a.d"];
  database(root, { directory: join(root, "build"), file: "../src/a.cpp", arguments: args });
  const invocation = resolveCompileInvocation(root, { file: "src/a.cpp" });
  assert.equal(invocation.cwd, join(root, "build"));
  assert.equal(invocation.compiler, "g++");
  assert.deepEqual(invocation.args, ["-I../include dir", "-DVALUE=42", "-std=c++20", "../src/a.cpp", "-fsyntax-only"]);
  const override = resolveCompileInvocation(root, { file: "src/a.cpp", compiler: "clang++", standard: "c++23" });
  assert.equal(override.compiler, "clang++");
  assert.ok(!override.args.includes("-std=c++20"));
  assert.ok(override.args.includes("-std=c++23"));
});

test("command entries support quoted paths and explicit build directories", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "custom"));
  writeFileSync(join(root, "custom", "compile_commands.json"), JSON.stringify([{
    directory: root, file: "src/a.cpp", command: `clang++ '-DNAME="hello world"' -c src/a.cpp -o 'custom/a file.o'`,
  }]));
  const invocation = resolveCompileInvocation(root, { file: "src/a.cpp", build_dir: "custom" });
  assert.deepEqual(invocation.args, ['-DNAME="hello world"', "src/a.cpp", "-fsyntax-only"]);
  assert.equal(findCompilationDatabase(root, "src/a.cpp", "custom"), join(root, "custom", "compile_commands.json"));
  assert.throws(() => findCompilationDatabase(root, "src/a.cpp", "missing"), /not found/);
});

test("existing databases never silently fall back for unmatched files, malformed entries, wrappers or response files", (t) => {
  const root = fixture(t);
  database(root, { directory: root, file: "src/other.cpp", arguments: ["clang++", "src/other.cpp"] });
  assert.throws(() => resolveCompileInvocation(root, { file: "src/a.cpp" }), /No compilation database entry/);
  database(root, { directory: root, file: "src/a.cpp", arguments: ["ccache", "clang++", "src/a.cpp"] });
  assert.throws(() => resolveCompileInvocation(root, { file: "src/a.cpp" }), /Unsupported compiler/);
  database(root, { directory: root, file: "src/a.cpp", arguments: ["clang++", "@flags", "src/a.cpp"] });
  assert.throws(() => resolveCompileInvocation(root, { file: "src/a.cpp" }), /Response files/);
  database(root, { directory: root, file: "src/a.cpp", arguments: ["clang++", 42] });
  assert.throws(() => resolveCompileInvocation(root, { file: "src/a.cpp" }), /string array/);
});

test("artifact flags are removed and unsupported pass-through flags produce errors", () => {
  assert.deepEqual(syntaxArguments(["-c", "a.c", "-oa.o", "-MMD", "-MFdep.d", "-MJ", "a.json", "-save-temps", "--coverage", "-gsplit-dwarf"]), ["a.c", "-fsyntax-only"]);
  for (const arg of ["-Xclang", "-Wp,-MD,dep.d", "-fmodules", "-ftime-trace", "--analyze"]) {
    assert.throws(() => syntaxArguments([arg]), /Unsupported compiler flag/);
  }
});

test("CMake module-scanning arguments are stripped instead of rejected", (t) => {
  // CMake 3.28+ with Ninja adds these to every C++20-or-newer entry (GCC form, then clang's response file).
  assert.deepEqual(syntaxArguments(["-std=gnu++26", "-fmodules-ts", "-fmodule-mapper=CMakeFiles/a.dir/a.cpp.o.modmap", "-MD", "-fdeps-format=p1689r5", "-x", "c++", "-c", "a.cpp"]),
    ["-std=gnu++26", "-x", "c++", "a.cpp", "-fsyntax-only"]);
  assert.deepEqual(syntaxArguments(["-std=c++26", "@CMakeFiles/a.dir/a.cpp.o.modmap", "-fdeps-file=a.ddi", "-fdeps-target=a.o", "a.cpp"]), ["-std=c++26", "a.cpp", "-fsyntax-only"]);
  assert.throws(() => syntaxArguments(["@flags.rsp"]), /Response files/);
  assert.throws(() => syntaxArguments(["-fmodules"]), /Unsupported compiler flag/);
  const root = fixture(t);
  database(root, { directory: join(root, "build"), file: "../src/a.cpp", command: "/usr/bin/g++ -std=gnu++26 -fmodules-ts -fmodule-mapper=CMakeFiles/a.dir/a.cpp.o.modmap -MD -fdeps-format=p1689r5 -x c++ -o a.o -c ../src/a.cpp" });
  assert.deepEqual(resolveCompileInvocation(root, { file: "src/a.cpp" }).args, ["-std=gnu++26", "-x", "c++", "../src/a.cpp", "-fsyntax-only"]);
});

test("a loaded database maps each real source path to its entry, and probe invocations drop the source and outputs", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "src", "a.cpp"), "");
  writeFileSync(join(root, "src", "b.cpp"), "");
  writeFileSync(join(root, "build", "compile_commands.json"), JSON.stringify([
    { directory: join(root, "build"), file: "../src/a.cpp", arguments: ["g++", "-I../include", "-DX=1", "-std=gnu++26", "-freflection", "-MD", "-MF", "a.d", "-o", "a.o", "-c", "../src/a.cpp"] },
    { directory: root, file: "src/b.cpp", command: "./tools/clang++ -std=c++26 -c src/b.cpp" },
  ]));
  const entries = loadCompilationDatabase(join(root, "build", "compile_commands.json"));
  const a = entries.get(realpathSync(join(root, "src", "a.cpp")));
  assert.ok(a);
  assert.equal(a.directory, join(root, "build"));
  const probe = probeInvocation(a);
  assert.equal(probe.compiler, "g++");
  assert.equal(probe.cwd, join(root, "build"));
  assert.deepEqual(probe.args, ["-I../include", "-DX=1", "-std=gnu++26", "-freflection"]);
  // A relative compiler path resolves against the entry's directory, as for cpp_compile.
  assert.equal(probeInvocation(entries.get(realpathSync(join(root, "src", "b.cpp")))!).compiler, join(root, "tools", "clang++"));
  assert.throws(() => probeInvocation({ ...a, argv: ["ccache", "g++", "../src/a.cpp"] }), /Unsupported compiler/);
});

test("real compiler uses database defines/includes/cwd and emits neither object nor dependency files", (t) => {
  const available = ["clang", "gcc"].find((compiler) => spawnSync(compiler, ["--version"]).status === 0);
  if (!available) { t.skip("No GCC/Clang compiler installed"); return; }
  const root = fixture(t);
  mkdirSync(join(root, "include dir"));
  writeFileSync(join(root, "include dir", "value.h"), "#define EXPECTED 42\n");
  writeFileSync(join(root, "src", "a.c"), '#include "value.h"\n_Static_assert(VALUE == EXPECTED, "wrong flags");\nint main(void) { return 0; }\n');
  database(root, { directory: join(root, "build"), file: "../src/a.c", arguments: [available, "-I../include dir", "-DVALUE=42", "-std=c17", "-c", "../src/a.c", "-o", "a.o", "-MMD", "-MF", "a.d"] });
  const invocation = resolveCompileInvocation(root, { file: "src/a.c" });
  const result = spawnSync(invocation.compiler, invocation.args, { cwd: invocation.cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(root, "build", "a.o")), false);
  assert.equal(existsSync(join(root, "build", "a.d")), false);
});

test("tool registrations forward database arguments/cwd and clang-tidy -p, and report process failures", async (t) => {
  const { default: register } = await import("../extensions/index.ts");
  const root = fixture(t);
  database(root, { directory: join(root, "build"), file: "../src/a.cpp", arguments: ["clang++", "-DVALUE=42", "-c", "../src/a.cpp", "-o", "a.o"] });
  const registered = new Map<string, any>();
  const calls: { name: string; args: string[]; options: any }[] = [];
  let response = { code: 0, stdout: "", stderr: "", killed: false };
  register({
    on() {}, registerCommand() {}, registerTool(tool: any) { registered.set(tool.name, tool); },
    async exec(name: string, args: string[], options: any) {
      calls.push({ name, args, options });
      return name === "sh" ? { code: 0, stdout: "", stderr: "", killed: false } : response;
    },
  } as any);
  const signal = new AbortController().signal;
  const compile = registered.get("cpp_compile");
  let result = await compile.execute("id", { file: "src/a.cpp" }, signal, undefined, { cwd: root });
  assert.equal(result.isError, false);
  assert.equal(calls.at(-1)?.name, "clang++");
  assert.equal(calls.at(-1)?.options.cwd, join(root, "build"));
  assert.deepEqual(calls.at(-1)?.args, ["-DVALUE=42", "../src/a.cpp", "-fsyntax-only"]);
  response = { code: 0, stdout: "", stderr: "", killed: true };
  result = await compile.execute("id", { file: "src/a.cpp" }, signal, undefined, { cwd: root });
  assert.equal(result.isError, true);
  const check = registered.get("cpp_check");
  response = { code: 0, stdout: "", stderr: "", killed: false };
  result = await check.execute("id", { file: "src/a.cpp", tool: "clang-tidy", build_dir: "build" }, signal, undefined, { cwd: root });
  assert.equal(result.isError, false);
  assert.deepEqual(calls.at(-1)?.args, [join(root, "src/a.cpp"), "-p", join(root, "build")]);
  response = { code: 1, stdout: "", stderr: "failed", killed: false };
  result = await check.execute("id", { file: "src/a.cpp", tool: "clang-tidy" }, signal, undefined, { cwd: root });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /failed/);
  response = { code: 0, stdout: "", stderr: "", killed: true };
  result = await check.execute("id", { file: "src/a.cpp", tool: "clang-tidy" }, signal, undefined, { cwd: root });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /interrupted/);
  result = await check.execute("id", { file: "src/a.cpp", tool: "unknown" }, signal, undefined, { cwd: root });
  assert.equal(result.isError, true);
});

test("without build_dir, cpp_compile and cpp_check use the managed compile_commands.json of a ready CMake model", async (t) => {
  if (spawnSync("cmake", ["--version"]).status !== 0 || spawnSync("c++", ["--version"]).status !== 0) { t.skip("cmake or a C++ compiler is not installed"); return; }
  const { default: register } = await import("../extensions/index.ts");
  const previousCache = process.env.XDG_CACHE_HOME;
  const cache = realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-cache-")));
  process.env.XDG_CACHE_HOME = cache;
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "cpp-compdb-managed-"))), "multi");
  cpSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "cmake", "multi"), root, { recursive: true });
  // Compiles only with the define the legacy library exports to app.
  writeFileSync(join(root, "app", "main.cpp"), '#include "legacy.h"\nstatic_assert(LEGACY_API == 1, "needs the project define");\nint main() { return legacy_value() == 42 ? 0 : 1; }\n');
  // A stale database in the old default location must not be picked.
  mkdirSync(join(root, "build"));
  writeFileSync(join(root, "build", "compile_commands.json"), "[]");

  const handlers = new Map<string, any[]>();
  const registered = new Map<string, any>();
  const execs: { name: string; args: string[] }[] = [];
  const exec = (name: string, args: string[], options: any = {}) => {
    execs.push({ name, args });
    const result = spawnSync(name, args, { cwd: options.cwd, timeout: options.timeout, encoding: "utf8" });
    return Promise.resolve({ stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? 1, killed: result.signal !== null });
  };
  register({
    exec, registerCommand() {}, registerTool(tool: any) { registered.set(tool.name, tool); },
    on(name: string, handler: any) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
  } as any);
  const ctx = { cwd: root, isProjectTrusted: () => true, ui: { notify() {} } };
  const emit = async (name: string, event: object) => { for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx); };
  t.after(async () => {
    await emit("session_shutdown", { reason: "quit" });
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previousCache;
    rmSync(dirname(root), { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });
  await emit("session_start", { reason: "startup" });
  await emit("before_agent_start", { prompt: "hi", messageType: "user", systemPrompt: "", systemPromptOptions: { promptGuidelines: [] } });

  const managed = join(cache, "pi-cpp-lsp");
  const compiled = await registered.get("cpp_compile").execute("id", { file: "app/main.cpp" }, undefined, undefined, ctx);
  assert.equal(compiled.isError, false, compiled.content[0].text);
  assert.ok(compiled.details.database.startsWith(managed), compiled.details.database);
  assert.ok(compiled.content[0].text.includes(compiled.details.database), compiled.content[0].text);
  assert.ok(compiled.details.args.includes("-DLEGACY_API=1"), compiled.details.args.join(" "));

  // An explicit build_dir still wins.
  const explicit = await registered.get("cpp_compile").execute("id", { file: "app/main.cpp", build_dir: "build" }, undefined, undefined, ctx);
  assert.equal(explicit.isError, true);
  assert.match(explicit.content[0].text, /No compilation database entry/);

  const checked = await registered.get("cpp_check").execute("id", { file: "app/main.cpp", tool: "clang-tidy" }, undefined, undefined, ctx);
  assert.ok(checked.details.database.startsWith(managed), checked.details.database);
  assert.ok(checked.content[0].text.includes(checked.details.database), checked.content[0].text);
  if (execs.some(call => call.name === "clang-tidy")) {
    assert.deepEqual(execs.findLast(call => call.name === "clang-tidy")?.args.slice(-2), ["-p", dirname(checked.details.database)]);
  }
});
