import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { findCompilationDatabase, resolveCompileInvocation, splitCommand, syntaxArguments } from "../extensions/lib/compdb.ts";

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
