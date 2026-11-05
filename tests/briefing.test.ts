import assert from "node:assert/strict";
import test from "node:test";
import { renderBriefing, type BriefingInput } from "../packages/core/src/project/briefing.ts";
import type { ConfigureResult } from "../packages/core/src/project/configure.ts";
import type { DriftFinding } from "../packages/core/src/project/drift.ts";
import type { ProjectModel, ProjectTarget, TargetKind } from "../packages/core/src/project/model.ts";
import { FEATURES, type TargetProfile } from "../packages/core/src/toolchain.ts";

const root = "/work/proj";

function target(name: string, kind: TargetKind, dirs: string[], options: { standard?: string; deps?: string[]; external?: boolean } = {}): ProjectTarget {
  const sources = dirs.map(dir => ({ path: `${root}/${dir}/${name}.cpp`, isGenerated: false, language: "CXX", backtrace: [] }));
  return {
    name, id: `${name}::@1`, type: kind === "library" ? "STATIC_LIBRARY" : "EXECUTABLE", kind,
    isProjectTarget: !options.external, sourceDir: `${root}/${dirs[0]}`, sources,
    cxxStandard: options.standard, includeDirs: [], defines: [], dependencies: options.deps ?? [], artifacts: [], backtrace: [],
  };
}

function model(targets: ProjectTarget[], notes: string[] = []): ProjectModel {
  return {
    sourceRoot: root, buildDir: "/cache/pi-cpp-lsp/abc/builds/preset-debug", indexFile: "/cache/index.json",
    cmakeVersion: "4.4.4", configuration: "Debug", targets, cmakeInputs: [], notes,
  };
}

function result(fields: Partial<ConfigureResult> = {}): ConfigureResult {
  return {
    status: "succeeded", sourceRoot: root, buildDir: "/cache/pi-cpp-lsp/abc/builds/preset-debug", preset: "debug", generator: "Ninja",
    args: [], startedAt: 0, finishedAt: 0, exitCode: 0, output: "CMake configure succeeded.", truncated: false, missingSources: [],
    reply: { newestIsError: false, newestFromThisRun: true }, notes: [], reusedFromOtherSession: false, ...fields,
  };
}

const findings: DriftFinding[] = [
  { kind: "missing", path: `${root}/libs/legacy/old.cpp`, targets: ["legacy"], location: { file: `${root}/libs/legacy/CMakeLists.txt`, line: 2 } },
  { kind: "unregistered", path: `${root}/libs/legacy/new.cpp`, uncovered: false, likelyGlob: false,
    candidates: [{ target: "legacy", location: { file: `${root}/libs/legacy/CMakeLists.txt`, line: 1, command: "add_library" } }] },
];

const base = (fields: Partial<BriefingInput> = {}): BriefingInput => ({
  root, status: "ready", findings: [], referenced: [], result: result(),
  model: model([
    target("legacy", "library", ["libs/legacy"], { standard: "14" }),
    target("app", "executable", ["app", "libs/legacy"], { standard: "20", deps: ["legacy"] }),
    target("unit_tests", "test", ["tests"], { deps: ["legacy"] }),
  ], ["CTest cannot resolve the executable of test smoke until it is built."]),
  ...fields,
});

test("the full briefing lists targets, configuration, hints, drift, inactive references and notes", () => {
  const text = renderBriefing(base({
    findings,
    referenced: [{ path: `${root}/platform/win_console.cpp`, file: `${root}/CMakeLists.txt`, line: 6 }],
  }));
  assert.match(text, /\| legacy \| library \| libs\/legacy \| C\+\+14 \| - \|/);
  assert.match(text, /\| app \| executable \| app, libs\/legacy \| C\+\+20 \| legacy \|/);
  assert.match(text, /\| unit_tests \| test \| tests \| compiler default \| legacy \|/);
  assert.match(text, /Preset: debug/);
  assert.match(text, /Configuration: Debug/);
  assert.match(text, /cpp_build/);
  assert.match(text, /cpp_test/);
  assert.match(text, /register/i);
  assert.match(text, /libs\/legacy\/old\.cpp.*missing.*libs\/legacy\/CMakeLists\.txt:2/i);
  assert.match(text, /libs\/legacy\/new\.cpp.*legacy.*libs\/legacy\/CMakeLists\.txt:1/);
  assert.match(text, /referenced in CMake but not built in this configuration/i);
  assert.match(text, /platform\/win_console\.cpp \(CMakeLists\.txt:6\)/);
  assert.match(text, /CTest cannot resolve the executable of test smoke/);
  assert.doesNotMatch(text, /cpp_project/);
  assert.ok(text.length <= 4000, `briefing is ${text.length} chars`);
});

test("a briefing over the budget becomes a summary that names every target and kind on one line", () => {
  const targets = Array.from({ length: 60 }, (_, i) => target(`component_${i}`, i % 3 === 0 ? "executable" : "library",
    [`src/components/component_${i}/detail`, `src/components/component_${i}/impl`], { standard: i % 2 ? "17" : "20", deps: i ? [`component_${i - 1}`] : [] }));
  const text = renderBriefing(base({ model: model(targets), findings }));
  assert.ok(text.length <= 4000, `summary is ${text.length} chars`);
  assert.doesNotMatch(text, /\| Target \|/);
  const line = text.split("\n").find(l => l.includes("component_0 (executable)"));
  assert.ok(line, text);
  for (let i = 0; i < 60; i++) assert.ok(line.includes(`component_${i} (${i % 3 === 0 ? "executable" : "library"})`), `component_${i}`);
  assert.match(text, /60 targets/);
  assert.match(text, /2 drift findings/);
  assert.match(text, /cpp_project/);
});

test("a failed configure briefing shows CMake's error and says which model is in use", () => {
  const output = "CMake configure failed (exit code 1).\n-- Configuring incomplete\nCMake Error at CMakeLists.txt:3 (find_package):\n  By not providing \"FindDoesNotExist.cmake\" in CMAKE_MODULE_PATH this project";
  const failed = result({ status: "failed", exitCode: 1, output });
  const withoutModel = renderBriefing(base({ status: "failed", model: undefined, result: failed }));
  assert.match(withoutModel, /CMake configure failed/);
  assert.match(withoutModel, /CMake Error at CMakeLists\.txt:3 \(find_package\)/);
  assert.match(withoutModel, /FindDoesNotExist/);
  assert.match(withoutModel, /no project model/i);
  const stale = renderBriefing(base({ status: "failed", result: failed }));
  assert.match(stale, /last successful configure/i);
  assert.match(stale, /\| legacy \| library/);
});

// ---------------------------------------------------------------------------
// C++ features

const upTo = (standard: number) => FEATURES.filter(feature => feature.standard <= standard).map(feature => feature.id);

/** GCC 16 on a C++26 target without -freflection, next to a clangd that lacks contracts and #embed. */
function gcc16(name: string, fields: Partial<TargetProfile> = {}): TargetProfile {
  return {
    target: name, standard: 26, compiler: "g++ 16", family: "gcc",
    available: upTo(26).filter(id => !["reflection", "meta", "hive", "trivial_relocatability"].includes(id)),
    needsFlag: { reflection: "-freflection", meta: "-freflection" }, clangdLacks: ["contracts", "embed"], gap: true, ...fields,
  };
}

const cxx26 = (...names: string[]) => model(names.map(name => target(name, "library", [`src/${name}`], { standard: "26" })));

test("a GCC 16 target without -freflection lists reflection as needing the flag and contracts as available", () => {
  const text = renderBriefing(base({ model: cxx26("core"), features: { profiles: [gcc16("core")], measuring: false } }));
  assert.ok(text.length <= 4000, `briefing is ${text.length} chars`);
  const lines = text.split("\n");
  assert.ok(lines.includes("## C++ features"), text);
  assert.ok(lines.includes("- core (C++26, g++ 16):"), text);
  assert.ok(lines.includes("  - Needs `-freflection`: static reflection, <meta>"), text);
  assert.ok(lines.includes("  - clangd lacks: contracts, #embed"), text);
  const cxx26Line = lines.find(line => line.startsWith("  - C++26: "));
  assert.ok(cxx26Line?.includes("contracts") && cxx26Line.includes("pack indexing"), text);
  assert.ok(!cxx26Line.includes("static reflection") && !cxx26Line.includes("std::hive"), cxx26Line);
  // Every available feature of the older standards is listed too.
  const cxx11Line = lines.find(line => line.startsWith("  - C++11: "));
  assert.ok(cxx11Line?.includes("rvalue references") && cxx11Line.includes("thread-safe static initialization"), text);
});

test("targets with the same profile share one line, and a target that could not be measured is left out", () => {
  const text = renderBriefing(base({
    model: cxx26("app", "core", "tool"),
    features: { measuring: false, profiles: [
      gcc16("app"), gcc16("core"),
      { target: "tool", standard: 26, available: [], needsFlag: {}, clangdLacks: [], gap: false, error: "c++ could not run the feature probe: cc1plus: error: bad flag" },
    ] },
  }));
  assert.match(text, /^- app, core \(C\+\+26, g\+\+ 16\):$/m);
  assert.doesNotMatch(text, /^- tool|could not be measured|bad flag/m);
});

test("without measured targets there is no feature section", () => {
  assert.doesNotMatch(renderBriefing(base()), /C\+\+ features/);
  assert.doesNotMatch(renderBriefing(base({ features: { profiles: [], measuring: false } })), /C\+\+ features/);
  // A check running for a model with no target on C++11 or newer will find nothing to report.
  const old = model([target("legacy", "library", ["libs/legacy"], { standard: "98" }), target("tests", "test", ["tests"])]);
  assert.doesNotMatch(renderBriefing(base({ model: old, features: { measuring: true } })), /C\+\+ features|feature check/);
});

test("a briefing rendered before the first measurement says the feature check is running", () => {
  const text = renderBriefing(base({ features: { measuring: true } }));
  assert.match(text, /## C\+\+ features\n.*still running.*later update/);
});

test("ten measured targets in three distinct profiles stay within the budget, summarized per group", () => {
  const names = Array.from({ length: 10 }, (_, i) => `component_${i}`);
  const profiles = names.map((name, i) => i < 4 ? gcc16(name)
    : i < 7 ? gcc16(name, { needsFlag: {}, available: upTo(26).filter(id => id !== "hive") })
    : { target: name, standard: 20 as const, compiler: "clang++ 21", family: "clang" as const, available: upTo(20), needsFlag: {}, clangdLacks: [], gap: false });
  const text = renderBriefing(base({ model: cxx26(...names), features: { profiles, measuring: false } }));
  assert.ok(text.length <= 4000, `briefing is ${text.length} chars`);
  assert.match(text, /\| component_9 \| library \|/, "the targets table stays");
  assert.match(text, /cpp_project overview/);
  assert.match(text, /^- component_0, component_1, component_2, component_3 \(C\+\+26, g\+\+ 16\): \d+ of \d+ listed features available; needs `-freflection`: static reflection, <meta>; clangd lacks: contracts, #embed\.$/m);
  assert.match(text, /^- component_7, component_8, component_9 \(C\+\+20, clang\+\+ 21\): all \d+ listed features available\.$/m);

  // Among sixty targets the briefing takes the summary form, and the groups still fit.
  const many = Array.from({ length: 60 }, (_, i) => target(`component_${i}`, "library",
    [`src/components/component_${i}/detail`, `src/components/component_${i}/impl`], { standard: i < 10 ? "26" : "98", deps: i ? [`component_${i - 1}`] : [] }));
  const summary = renderBriefing(base({ model: model(many), findings, features: { profiles, measuring: false } }));
  assert.ok(summary.length <= 4000, `summary is ${summary.length} chars`);
  assert.doesNotMatch(summary, /\| Target \|/);
  assert.match(summary, /cpp_project overview/);
  assert.equal(summary.split("\n").filter(line => /^- component_\d.*listed features available/.test(line)).length, 3, summary);
});
