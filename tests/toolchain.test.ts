import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import type { CompilationEntry } from "../extensions/lib/compdb.ts";
import type { Exec } from "../extensions/lib/project/configure.ts";
import { measureClangd, measureCompiler, parseMacros, presentFeatures, probeSource } from "../extensions/lib/toolchain.ts";

const mockClangd = resolve("tests/fixtures/mock-clangd.mjs");
const mock = (...features: string[]) => ({ command: process.execPath, args: [mockClangd, `--mock-features=${features.join(",")}`], timeoutMs: 2000 });

// Macro dumps as GCC 16 and clang 23 print them for `-std=c++26` (trimmed to what the catalog reads).
const GCC16 = [
  "#define __GNUC__ 16", "#define __cpp_contracts 202502L", "#define __cpp_pack_indexing 202311L", "#define __cpp_pp_embed 202502L",
  "#define __cpp_expansion_statements 202506L", "#define __cpp_constexpr_exceptions 202411L", "#define __cpp_placeholder_variables 202306L",
  "#define __cpp_deleted_function 202403L", "#define __cpp_structured_bindings 202411L", "#define __cpp_variadic_friend 202403L",
  "#define __cpp_lib_inplace_vector 202603L", "#define __cpp_lib_saturation_arithmetic 202603L", "#define __cpp_lib_text_encoding 202306L",
].join("\n");
const GCC16_REFLECTION = `${GCC16}\n#define __cpp_impl_reflection 202603L\n#define __cpp_lib_reflection 202603L`;
const CLANG23 = [
  "#define __clang__ 1", "#define __clang_major__ 23", "#define __GNUC__ 4", "#define __cpp_pack_indexing 202311L",
  "#define __cpp_placeholder_variables 202306L", "#define __cpp_deleted_function 202403L", "#define __cpp_structured_bindings 202411L",
  "#define __cpp_variadic_friend 202403L", "#define __cpp_trivial_relocatability 202502L", "#define PI_CPP_LSP_ALT_embed 1",
].join("\n");

const entry = (argv: string[]): CompilationEntry => ({ file: "/project/src/a.cpp", directory: "/project/build", argv: [...argv, "-c", "../src/a.cpp", "-o", "a.o"] });

/** A compiler that answers probe dumps: `respond` maps the extra flags before -dM to a result. */
function fakeCompiler(respond: (extra: string[], args: string[]) => Partial<ExecResult>) {
  const calls: { command: string; args: string[]; options?: ExecOptions }[] = [];
  const exec: Exec = async (command, args, options) => {
    calls.push({ command, args, options });
    const probe = args.at(-1)!;
    assert.ok(existsSync(probe), "the probe exists while the compiler runs");
    const extra = args.slice(args.indexOf("-std=c++26") + 1, args.indexOf("-dM"));
    return { stdout: "", stderr: "", code: 0, killed: false, ...respond(extra, args) };
  };
  return { exec, calls };
}

test("a GCC 16 dump reports contracts available and reflection behind -freflection", async () => {
  const { exec, calls } = fakeCompiler(extra => ({ stdout: extra.includes("-freflection") ? GCC16_REFLECTION : GCC16 }));
  const result = await measureCompiler(entry(["g++", "-I../include", "-std=c++26"]), exec);
  assert.ok(result.ok);
  assert.equal(result.compiler, "g++ 16");
  assert.equal(result.family, "gcc");
  assert.ok(result.available.includes("contracts"));
  assert.ok(result.available.includes("embed"));
  assert.ok(!result.available.includes("reflection"));
  assert.deepEqual(result.needsFlag, { reflection: "-freflection", meta: "-freflection" });
  // One plain probe, one with the flag; both run the entry's flags in its directory without its source or outputs.
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]!.args.slice(0, 2), ["-I../include", "-std=c++26"]);
  assert.ok(!calls[0]!.args.includes("../src/a.cpp") && !calls[0]!.args.includes("-o"));
  assert.equal(calls[0]!.options?.cwd, "/project/build");
  assert.ok(!existsSync(calls[0]!.args.at(-1)!), "the probe directory is removed afterwards");
});

test("a target that already passes -freflection gets reflection as available, with no second probe", async () => {
  const { exec, calls } = fakeCompiler(() => ({ stdout: GCC16_REFLECTION }));
  const result = await measureCompiler(entry(["g++", "-std=c++26", "-freflection"]), exec);
  assert.ok(result.ok);
  assert.ok(result.available.includes("reflection") && result.available.includes("meta"));
  assert.deepEqual(result.needsFlag, {});
  assert.equal(calls.length, 1);
});

test("a failing -freflection probe leaves reflection missing and keeps the first result", async () => {
  const { exec } = fakeCompiler(extra => extra.includes("-freflection")
    ? { code: 1, stderr: "g++: error: unrecognized command-line option '-freflection'" }
    : { stdout: GCC16 });
  const result = await measureCompiler(entry(["g++", "-std=c++26"]), exec);
  assert.ok(result.ok);
  assert.deepEqual(result.needsFlag, {});
  assert.ok(result.available.includes("contracts"));
});

test("a clang dump gets no flag probe, and #embed counts through __has_embed", async () => {
  const { exec, calls } = fakeCompiler(() => ({ stdout: CLANG23 }));
  const result = await measureCompiler(entry(["clang++", "-std=c++26"]), exec);
  assert.ok(result.ok);
  assert.equal(result.compiler, "clang++ 23");
  assert.equal(result.family, "clang");
  assert.ok(result.available.includes("embed"));
  assert.ok(result.available.includes("trivial_relocatability"));
  assert.ok(!result.available.includes("contracts"));
  assert.equal(calls.length, 1);
});

test("a macro below the catalog's C++26 value counts as missing", () => {
  // __cpp_structured_bindings 201606L is C++17; C++26 binding packs need 202411L.
  const present = presentFeatures(parseMacros("#define __cpp_structured_bindings 201606L\n#define __cpp_pack_indexing 202311L"));
  assert.deepEqual([...present], ["pack_indexing"]);
});

test("a failing first probe or an unsupported compiler gives a reason instead of throwing", async () => {
  const failing = fakeCompiler(() => ({ code: 1, stderr: "cc1plus: fatal error: bad flag" }));
  const failed = await measureCompiler(entry(["g++", "-std=c++26"]), failing.exec);
  assert.deepEqual(failed, { ok: false, reason: "g++ could not run the feature probe: cc1plus: fatal error: bad flag" });
  const wrapped = await measureCompiler(entry(["ccache", "g++", "-std=c++26"]), failing.exec);
  assert.equal(wrapped.ok, false);
  assert.match(!wrapped.ok ? wrapped.reason : "", /Unsupported compiler/);
});

test("the clangd probe reports the features the mock clangd answers for", async () => {
  const before = readdirSync(tmpdir()).filter(name => name.startsWith("pi-cpp-lsp-probe-")).length;
  const result = await measureClangd(entry(["g++", "-std=c++26", "-freflection"]), mock("pack_indexing", "placeholder_variables"));
  assert.deepEqual(result, { ok: true, available: ["pack_indexing", "placeholder_variables"] });
  assert.equal(readdirSync(tmpdir()).filter(name => name.startsWith("pi-cpp-lsp-probe-")).length, before, "the probe directory is removed");
});

test("-w and -Werror in the compile command do not hide the clangd probe's warnings", async () => {
  const result = await measureClangd(entry(["g++", "-std=c++26", "-w", "-Werror", "-Werror=vla"]), mock("embed"));
  assert.deepEqual(result, { ok: true, available: ["embed"] });
});

test("a missing or silent clangd gives a reason", async () => {
  const missing = await measureClangd(entry(["g++", "-std=c++26"]), { command: "/nonexistent/clangd", timeoutMs: 1000 });
  assert.equal(missing.ok, false);
  const silent = await measureClangd(entry(["g++", "-std=c++26"]), { command: process.execPath, args: [mockClangd, "init-hang"], timeoutMs: 200 }, 200);
  assert.equal(silent.ok, false);
});

test("the clangd probe asks for every catalog feature with its C++26 threshold", () => {
  const source = probeSource(true);
  assert.match(source, /#if \(defined\(__cpp_contracts\) && __cpp_contracts >= 202502L\)\n#warning "pi-cpp-lsp-feature:contracts"/);
  assert.match(source, /\|\| \(defined\(__has_embed\)\)/);
  assert.match(probeSource(false), /#if defined\(__has_embed\)\n#define PI_CPP_LSP_ALT_embed 1/);
});

const gcc = spawnSync("g++", ["-std=c++26", "-freflection", "-x", "c++", "-fsyntax-only", "-"], { input: "" }).status === 0;
const clangdMajor = Number(/clangd version (\d+)/.exec(spawnSync("clangd", ["--version"], { encoding: "utf8" }).stdout ?? "")?.[1] ?? 0);

test("real GCC with reflection: the plain probe needs -freflection, the flagged one has it", { skip: !gcc && "g++ does not accept -std=c++26 -freflection" }, async () => {
  const exec: Exec = async (command, args, options) => {
    const result = spawnSync(command, args, { cwd: options?.cwd, encoding: "utf8" });
    return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? 1, killed: false };
  };
  const plain = await measureCompiler({ file: "/x.cpp", directory: tmpdir(), argv: ["g++", "-std=c++26", "/x.cpp"] }, exec);
  assert.ok(plain.ok);
  assert.equal(plain.needsFlag.reflection, "-freflection");
  assert.ok(plain.available.includes("contracts") && plain.available.includes("embed"));
  const flagged = await measureCompiler({ file: "/x.cpp", directory: tmpdir(), argv: ["g++", "-std=c++26", "-freflection", "/x.cpp"] }, exec);
  assert.ok(flagged.ok && flagged.available.includes("reflection"));
});

test("real clangd 23+ under a GCC reflection command lacks reflection and contracts but has #embed", { skip: clangdMajor < 23 && "needs clangd 23 or newer" }, async () => {
  const result = await measureClangd({ file: "/x.cpp", directory: tmpdir(), argv: ["g++", "-std=c++26", "-freflection", "/x.cpp"] });
  assert.ok(result.ok, !result.ok ? result.reason : "");
  assert.ok(!result.available.includes("reflection") && !result.available.includes("contracts"));
  assert.ok(result.available.includes("pack_indexing") && result.available.includes("embed"));
});

// Keep the fixture reader used so a broken mock fails loudly rather than skipping.
assert.ok(readFileSync(mockClangd, "utf8").includes("--mock-features="));
