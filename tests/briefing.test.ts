import assert from "node:assert/strict";
import test from "node:test";
import { renderBriefing, type BriefingInput } from "../extensions/lib/project/briefing.ts";
import type { ConfigureResult } from "../extensions/lib/project/configure.ts";
import type { DriftFinding } from "../extensions/lib/project/drift.ts";
import type { ProjectModel, ProjectTarget, TargetKind } from "../extensions/lib/project/model.ts";

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
