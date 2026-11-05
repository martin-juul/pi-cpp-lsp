import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import type { CompilationEntry } from "../packages/core/src/compdb.ts";
import type { Exec } from "../packages/core/src/exec.ts";
import type { ProjectModel, ProjectTarget } from "../packages/core/src/project/model.ts";
import { catalogStandard, measureClangd, measureCompiler, parseMacros, presentFeatures, probeSource, setupFeatureLines, ToolchainService, type ToolchainProject } from "../packages/core/src/toolchain.ts";

// The probe-directory count below must see only this file's probes, not those of test files
// running at the same time, such as /cpp-setup's.
process.env.TMPDIR = mkdtempSync(join(tmpdir(), "pi-cpp-toolchain-tmp-"));

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
  // One plain probe, then one per enabling flag (-fmodules finds nothing in this dump); all run the
  // entry's flags in its directory without its source or outputs.
  assert.deepEqual(calls.map(call => call.args.filter(arg => arg === "-freflection" || arg === "-fmodules")), [[], ["-fmodules"], ["-freflection"]]);
  assert.deepEqual(calls[0]!.args.slice(0, 2), ["-I../include", "-std=c++26"]);
  assert.ok(!calls[0]!.args.includes("../src/a.cpp") && !calls[0]!.args.includes("-o"));
  assert.equal(calls[0]!.options?.cwd, "/project/build");
  assert.ok(!existsSync(calls[0]!.args.at(-1)!), "the probe directory is removed afterwards");
});

test("a target that already passes -freflection gets reflection as available, with no -freflection probe", async () => {
  const { exec, calls } = fakeCompiler(() => ({ stdout: GCC16_REFLECTION }));
  const result = await measureCompiler(entry(["g++", "-std=c++26", "-freflection"]), exec);
  assert.ok(result.ok);
  assert.ok(result.available.includes("reflection") && result.available.includes("meta"));
  assert.deepEqual(result.needsFlag, {});
  assert.ok(!calls.some(call => call.args.filter(arg => arg === "-freflection").length > 1));
  assert.equal(calls.length, 2, "only the -fmodules probe follows");
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

test("a macro without a value does not hide the next line of the dump", () => {
  const macros = parseMacros("#define __STRICT_ANSI__\n#define __cpp_concepts 202002L\n#define F(x) x\n#define __cpp_lambdas 200907L");
  assert.equal(macros.get("__STRICT_ANSI__"), "");
  assert.equal(macros.get("__cpp_concepts"), "202002L");
  assert.equal(macros.get("__cpp_lambdas"), "200907L");
});

test("a macro below a feature's value counts as missing for that feature", () => {
  // __cpp_structured_bindings 201606L is C++17; C++26 binding packs need 202411L.
  const present = presentFeatures(parseMacros("#define __cpp_structured_bindings 201606L\n#define __cpp_pack_indexing 202311L"));
  assert.deepEqual([...present], ["structured_bindings", "pack_indexing"]);
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

test("a clangd probe cut short before its last marker is a failed measurement, not missing features", async () => {
  const result = await measureClangd(entry(["g++", "-std=c++26"]), { ...mock("pack_indexing"), args: [...mock("pack_indexing").args, "--mock-cut-short"] });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : "", /cut short/);
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

test("real clangd measures the same features with -pedantic-errors before C++23, where #warning is an extension", { skip: clangdMajor < 23 && "needs clangd 23 or newer" }, async () => {
  const plain = await measureClangd({ file: "/x.cpp", directory: tmpdir(), argv: ["clang++", "-std=c++17", "/x.cpp"] });
  const pedantic = await measureClangd({ file: "/x.cpp", directory: tmpdir(), argv: ["clang++", "-std=c++17", "-pedantic-errors", "-ferror-limit=5", "/x.cpp"] });
  assert.ok(plain.ok && pedantic.ok, JSON.stringify([plain, pedantic]));
  assert.ok(plain.available.length > 50);
  assert.deepEqual(pedantic.available, plain.available);
});

test("real clangd 23+ under a GCC reflection command lacks reflection and contracts but has #embed", { skip: clangdMajor < 23 && "needs clangd 23 or newer" }, async () => {
  const result = await measureClangd({ file: "/x.cpp", directory: tmpdir(), argv: ["g++", "-std=c++26", "-freflection", "/x.cpp"] });
  assert.ok(result.ok, !result.ok ? result.reason : "");
  assert.ok(!result.available.includes("reflection") && !result.available.includes("contracts"));
  assert.ok(result.available.includes("pack_indexing") && result.available.includes("embed"));
});

// ---------------------------------------------------------------------------
// The per-session service

/** A project tree with a compilation database, and a model whose targets the test names. */
function project(t: { after: (fn: () => void) => void }, targets: { name: string; standard?: string; sources: string[]; flags?: string[]; includeDirs?: string[] }[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cpp-toolchain-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const build = join(root, "build");
  mkdirSync(build);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "include"));
  const entries: object[] = [];
  const modelTargets = targets.map((spec): ProjectTarget => {
    const standard = spec.standard ?? "26";
    const sources = spec.sources.map(file => {
      const path = join(root, file);
      writeFileSync(path, "");
      entries.push({ directory: build, file: path, arguments: ["g++", ...(spec.flags ?? []), `-std=c++${standard}`, "-c", path] });
      return { path, isGenerated: false, language: "CXX", standard, backtrace: [] };
    });
    return {
      name: spec.name, id: spec.name, type: "EXECUTABLE", kind: "executable", isProjectTarget: true, sourceDir: root, sources,
      cxxStandard: standard, includeDirs: (spec.includeDirs ?? []).map(dir => join(root, dir)), defines: [], dependencies: [], artifacts: [], backtrace: [],
    };
  });
  writeFileSync(join(build, "compile_commands.json"), JSON.stringify(entries));
  const model: ProjectModel = { sourceRoot: root, buildDir: build, indexFile: "", cmakeVersion: "4.4", configuration: "Debug", targets: modelTargets, cmakeInputs: [], notes: [] };
  const listeners = new Set<(change: { model: ProjectModel; compileDatabase: string; compileDatabaseChanged: boolean }) => void>();
  const fake: ToolchainProject & { change(next: ProjectModel, compileDatabaseChanged: boolean): void } = {
    model,
    onModelChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    change(next, compileDatabaseChanged) {
      (fake as { model: ProjectModel }).model = next;
      for (const listener of listeners) listener({ model: next, compileDatabase: join(build, "compile_commands.json"), compileDatabaseChanged });
    },
  };
  return { root, model, project: fake };
}

const C20 = "#define __cpp_concepts 202002L\n#define __cpp_lib_span 202002L";

/** g++ answers with GCC 16's C++26 dump plus C++20 macros; `-DOLD` drops contracts. Counts plain probes. */
function service(clangdFeatures: string[]) {
  const probes: string[][] = [];
  const exec: Exec = async (_command, args) => {
    if (!args.some(arg => arg === "-freflection" || arg === "-fmodules")) probes.push(args);
    const dump = `${C20}\n${GCC16}`.split("\n").filter(line => !(args.includes("-DOLD") && line.includes("__cpp_contracts"))).join("\n");
    return { stdout: dump, stderr: "", code: 0, killed: false };
  };
  return { probes, toolchain: new ToolchainService({ exec, clangd: mock(...clangdFeatures), clangdTimeoutMs: 2000 }) };
}

test("what clangd lacks and what could not be measured is logged, once per measurement", async (t) => {
  const { project: fake } = project(t, [
    { name: "app", sources: ["src/app.cpp"] },
    { name: "tool", sources: ["src/tool.cpp"], flags: ["-DBROKEN"] },
  ]);
  const logged: string[] = [];
  const exec: Exec = async (_command, args) => args.includes("-DBROKEN")
    ? { stdout: "", stderr: "cc1plus: error: bad flag", code: 1, killed: false }
    : { stdout: GCC16, stderr: "", code: 0, killed: false };
  const toolchain = new ToolchainService({ exec, clangd: mock("pack_indexing"), clangdTimeoutMs: 2000, log: line => logged.push(line) });
  t.after(() => toolchain.close());
  toolchain.attach(fake);
  await toolchain.settled();
  assert.equal(logged.length, 2, logged.join("\n"));
  assert.match(logged.join("\n"), /target app \(g\+\+ 16\): clangd lacks .*contracts/);
  assert.match(logged.join("\n"), /target tool: the build compiler could not be measured: .*bad flag/);
});

test("standards map to the newest catalog standard not newer than them", () => {
  assert.deepEqual(["98", "03", "11", "14", "17", "20", "23", "26", "29", undefined].map(catalogStandard), [undefined, undefined, 11, 14, 17, 20, 23, 26, 26, undefined]);
});

test("only targets on C++11 or newer are measured, each for its own standard's features", async (t) => {
  const { project: fake } = project(t, [
    { name: "app", sources: ["src/app.cpp"] },
    { name: "lib", standard: "20", sources: ["src/lib.cpp"] },
    { name: "legacy", standard: "03", sources: ["src/legacy.cpp"] },
  ]);
  const { toolchain } = service(["structured_bindings", "concepts", "span", "pack_indexing"]);
  t.after(() => toolchain.close());
  toolchain.attach(fake);
  await toolchain.settled();
  const profiles = toolchain.profiles!;
  assert.deepEqual(profiles.map(profile => [profile.target, profile.standard]), [["app", 26], ["lib", 20]]);
  const lib = profiles.find(profile => profile.target === "lib")!;
  // The dump's __cpp_structured_bindings 202411 also counts as C++17 structured bindings.
  assert.deepEqual(lib.available, ["structured_bindings", "concepts", "span"]);
  assert.equal(lib.gap, false);
  const app = profiles.find(profile => profile.target === "app")!;
  assert.equal(app.compiler, "g++ 16");
  assert.ok(app.available.includes("contracts") && app.available.includes("concepts"));
  assert.ok(app.clangdLacks.includes("contracts") && !app.clangdLacks.includes("pack_indexing"));
  assert.equal(app.gap, true);
});

test("targets sharing a compile command share one measurement, and a target's groups intersect", async (t) => {
  const { project: fake } = project(t, [
    { name: "one", sources: ["src/a.cpp", "src/b.cpp"] },
    { name: "two", sources: ["src/c.cpp"] },
    { name: "mixed", sources: ["src/d.cpp"], flags: ["-DOLD"] },
  ]);
  // A second group for "mixed": same target, but this source compiles without -DOLD.
  const { toolchain, probes } = service([]);
  t.after(() => toolchain.close());
  const model = fake.model!;
  const mixed = model.targets.find(target => target.name === "mixed")!;
  (mixed.sources as unknown[]).push(model.targets[0]!.sources[0]);
  toolchain.attach(fake);
  await toolchain.settled();
  assert.equal(probes.length, 2, "one probe for the shared command, one for -DOLD");
  const profile = toolchain.profiles!.find(profile => profile.target === "mixed")!;
  assert.ok(!profile.available.includes("contracts"), "the -DOLD group lacks contracts, so the target does");
});

test("a model change measures again only when the compilation database changed", async (t) => {
  const { project: fake, model } = project(t, [{ name: "app", sources: ["src/app.cpp"] }]);
  const { toolchain, probes } = service([]);
  t.after(() => toolchain.close());
  toolchain.attach(fake);
  await toolchain.settled();
  fake.change({ ...model }, false);
  await toolchain.settled();
  assert.equal(probes.length, 1);
  fake.change({ ...model }, true);
  await toolchain.settled();
  assert.equal(probes.length, 2);
});

test("a reconfigure that leaves the compilation database unchanged does not restart the first measurement", async (t) => {
  const { project: fake, model } = project(t, [{ name: "app", sources: ["src/app.cpp"] }]);
  const { toolchain, probes } = service([]);
  t.after(() => toolchain.close());
  toolchain.attach(fake);
  fake.change({ ...model }, false);
  fake.change({ ...model }, false);
  await toolchain.settled();
  assert.equal(probes.length, 1);
  assert.deepEqual(toolchain.profiles!.map(profile => profile.target), ["app"]);
});

test("a newer model replaces a measurement still running", async (t) => {
  const { project: fake, model } = project(t, [{ name: "first", sources: ["src/a.cpp"] }, { name: "second", standard: "20", sources: ["src/b.cpp"] }]);
  const { toolchain } = service([]);
  t.after(() => toolchain.close());
  toolchain.attach(fake);
  fake.change({ ...model, targets: model.targets.filter(target => target.name === "second") }, true);
  await toolchain.settled();
  assert.deepEqual(toolchain.profiles!.map(profile => profile.target), ["second"]);
});

test("a file belongs to the gap profile of its owner, and an unowned header to the target that includes its directory", async (t) => {
  const { root, project: fake } = project(t, [
    { name: "gap", sources: ["src/gap.cpp"], includeDirs: ["include"] },
    { name: "clean", standard: "20", sources: ["src/clean.cpp"] },
  ]);
  writeFileSync(join(root, "include", "api.hpp"), "");
  writeFileSync(join(root, "src", "stray.hpp"), "");
  const { toolchain } = service(["structured_bindings", "concepts", "span"]);
  t.after(() => toolchain.close());
  toolchain.attach(fake);
  await toolchain.settled();
  assert.equal(toolchain.gapProfileFor(join(root, "src", "gap.cpp"))?.target, "gap");
  assert.equal(toolchain.gapProfileFor(join(root, "include", "api.hpp"))?.target, "gap");
  assert.equal(toolchain.gapProfileFor(join(root, "src", "stray.hpp")), undefined);
  assert.equal(toolchain.gapProfileFor(join(root, "src", "clean.cpp")), undefined);
  assert.deepEqual(toolchain.gapProfiles.map(profile => profile.target), ["gap"]);
});

// Keep the fixture reader used so a broken mock fails loudly rather than skipping.
assert.ok(readFileSync(mockClangd, "utf8").includes("--mock-features="));

// ---------------------------------------------------------------------------
// /cpp-setup

/** Runs `body` with $CXX set to `value`, or unset for undefined. */
async function withCxx<T>(value: string | undefined, body: () => Promise<T>): Promise<T> {
  const saved = process.env.CXX;
  if (value === undefined) delete process.env.CXX;
  else process.env.CXX = value;
  try {
    return await body();
  } finally {
    if (saved === undefined) delete process.env.CXX;
    else process.env.CXX = saved;
  }
}

/** A shell that finds `present` commands, then the fake compiler for everything else. */
function onPath(present: string[], compiler: Exec): Exec {
  return async (command, args, options) => command === "sh"
    ? { stdout: "", stderr: "", code: present.includes(args.at(-1)!) ? 0 : 1, killed: false }
    : compiler(command, args, options);
}

test("/cpp-setup lists the default compiler's and clangd's features side by side", async () => {
  const { exec, calls } = fakeCompiler(extra => ({ stdout: extra.includes("-freflection") ? GCC16_REFLECTION : GCC16 }));
  const lines = await withCxx(undefined, () => setupFeatureLines(onPath(["c++"], exec), { clangd: mock("pack_indexing", "placeholder_variables", "trivial_relocatability"), clangdTimeoutMs: 2000 }));
  assert.equal(calls[0]!.command, "c++");
  assert.deepEqual(calls[0]!.args.slice(0, 1), ["-std=c++26"]);
  assert.equal(lines[0], "✓ C++ compiler: c++ 16 (gcc), measured with -std=c++26");
  const cxx26 = lines.find(line => line.startsWith("  C++26: "));
  assert.ok(cxx26, lines.join("\n"));
  assert.match(cxx26, /both: pack indexing, the _ placeholder;/);
  assert.match(cxx26, /compiler only: contracts, #embed,/);
  assert.match(cxx26, /clangd only: trivial relocatability;/);
  assert.match(cxx26, /compiler needs `-freflection`: static reflection, <meta>;/);
  assert.match(cxx26, /neither: .*std::hive/);
});

test("/cpp-setup measures $CXX, and says so when the compiler is not on PATH", async () => {
  const { exec, calls } = fakeCompiler(() => ({ stdout: CLANG23 }));
  const lines = await withCxx("clang++-23", () => setupFeatureLines(onPath(["clang++-23"], exec), { clangd: mock("embed"), clangdTimeoutMs: 2000 }));
  assert.equal(calls[0]!.command, "clang++-23");
  assert.equal(lines[0], "✓ C++ compiler: clang++-23 23 (clang), measured with -std=c++26");

  const missing = await withCxx(undefined, () => setupFeatureLines(onPath([], exec), { clangd: mock("embed", "pack_indexing"), clangdTimeoutMs: 2000 }));
  assert.equal(missing[0], "✗ C++ compiler: c++ was not found on PATH; set CXX to measure another compiler");
  // clangd's list still shows.
  assert.ok(missing.some(line => line.startsWith("  C++26: clangd: pack indexing, #embed;")), missing.join("\n"));
});
