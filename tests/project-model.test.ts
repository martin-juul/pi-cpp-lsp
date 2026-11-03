import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import { ConfigureManager, probeCmake, type Exec } from "../extensions/lib/project/configure.ts";
import {
  declaringLocation, effectiveStandard, findTarget, formatStandard, loadProjectModel, ownersOf, ProjectModelError,
  type ProjectModel, type ProjectTarget,
} from "../extensions/lib/project/model.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "cmake");
const hasCmake = spawnSync("cmake", ["--version"]).status === 0;

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

function freshCache(): void {
  process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "pi-cpp-cache-"));
}

function tempDir(prefix = "pi-cpp-model-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[relative(dir, path)] = readFileSync(path, "utf8");
    }
  };
  walk(dir);
  return files;
}

async function configure(root: string): Promise<{ buildDir: string; index: string }> {
  const result = await new ConfigureManager({ root, exec: nodeExec }).trigger();
  assert.equal(result.status, "succeeded", result.output);
  assert.ok(result.buildDir && result.reply.lastGood);
  return { buildDir: result.buildDir, index: result.reply.lastGood };
}

const target = (model: ProjectModel, name: string): ProjectTarget => {
  const found = findTarget(model, name);
  assert.ok(found, `target ${name} in ${model.targets.map(t => t.name).join(", ")}`);
  return found;
};
const sourceNames = (t: ProjectTarget, root: string) => t.sources.filter(s => !s.isGenerated).map(s => relative(root, s.path)).sort();

test("the multi fixture yields targets with kinds, sources, standards, dependencies and backtraces", { skip: !hasCmake }, async () => {
  freshCache();
  const root = realpathSync(join(fixtures, "multi"));
  const before = snapshot(root);
  const { buildDir, index } = await configure(root);

  // Before a build, CTest omits the command; the generated CTestTestfile.cmake still classifies the test.
  const unbuilt = await loadProjectModel({ indexFile: index, exec: nodeExec });
  assert.equal(target(unbuilt, "unit_tests").kind, "test");
  assert.ok(!unbuilt.notes.some(note => note.includes("unit")), unbuilt.notes.join("\n"));

  const build = spawnSync("cmake", ["--build", buildDir], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const model = await loadProjectModel({ indexFile: index, exec: nodeExec });

  assert.equal(model.sourceRoot, root);
  assert.equal(model.buildDir, realpathSync(buildDir));
  assert.deepEqual(model.targets.map(t => t.name).sort(), ["app", "legacy", "unit_tests"]);

  const legacy = target(model, "legacy");
  const app = target(model, "app");
  const unit = target(model, "unit_tests");
  assert.deepEqual([legacy.type, legacy.kind], ["STATIC_LIBRARY", "library"]);
  assert.deepEqual([app.type, app.kind], ["EXECUTABLE", "executable"]);
  assert.deepEqual([unit.type, unit.kind], ["EXECUTABLE", "test"]);
  assert.ok(model.targets.every(t => t.isProjectTarget));
  assert.equal(legacy.sourceDir, join(root, "libs", "legacy"));

  assert.deepEqual(sourceNames(legacy, root), ["libs/legacy/extra.cpp", "libs/legacy/legacy.cpp", "libs/legacy/shared.cpp"]);
  assert.deepEqual(sourceNames(app, root), ["app/main.cpp", "libs/legacy/shared.cpp"]);
  assert.deepEqual([legacy.cxxStandard, app.cxxStandard], ["14", "20"]);
  assert.equal(formatStandard(legacy.cxxStandard), "C++14");
  assert.equal(formatStandard(undefined), "compiler default");
  assert.deepEqual(app.dependencies, ["legacy"]);
  assert.deepEqual(unit.dependencies, ["legacy"]);
  assert.deepEqual(legacy.dependencies, []);
  assert.ok(legacy.includeDirs.includes(join(root, "libs", "legacy", "include")), legacy.includeDirs.join("\n"));
  assert.ok(app.includeDirs.includes(join(root, "libs", "legacy", "include")), app.includeDirs.join("\n"));
  assert.ok(legacy.defines.includes("LEGACY_API=1"));
  assert.ok(unit.artifacts.length === 1 && unit.artifacts[0].startsWith(model.buildDir + "/"), unit.artifacts.join());

  // Generated sources: one from a custom command, one from configure_file.
  const generated = legacy.sources.filter(s => s.isGenerated).map(s => basename(s.path));
  assert.ok(generated.includes("generated.cpp") && generated.includes("version.h"), generated.join());

  // A source added by target_sources reports that call.
  const extra = legacy.sources.find(s => s.path === join(root, "libs", "legacy", "extra.cpp"));
  assert.ok(extra);
  assert.deepEqual(declaringLocation(extra.backtrace, model.sourceRoot), {
    file: join(root, "libs", "legacy", "CMakeLists.txt"), line: 2, command: "target_sources",
  });

  // A file compiled into two targets has both owners, and the lower standard wins (AE8).
  const shared = join(root, "libs", "legacy", "shared.cpp");
  assert.deepEqual(ownersOf(model, shared).map(t => t.name).sort(), ["app", "legacy"]);
  assert.equal(effectiveStandard(model, shared), "14");
  assert.equal(effectiveStandard(model, join(root, "app", "main.cpp")), "20");
  assert.deepEqual(ownersOf(model, join(root, "unregistered.cpp")), []);

  // CMake inputs keep project files and drop CMake's generated and bundled modules.
  for (const file of ["CMakeLists.txt", "libs/legacy/CMakeLists.txt", "app/CMakeLists.txt", "tests/CMakeLists.txt", "libs/legacy/version.h.in"]) {
    assert.ok(model.cmakeInputs.includes(join(root, file)), `${file} in ${model.cmakeInputs.join("\n")}`);
  }
  assert.ok(model.cmakeInputs.every(path => path.startsWith(root + "/")), model.cmakeInputs.join("\n"));

  assert.throws(() => { (model.targets as ProjectTarget[]).push(app); }, TypeError);
  assert.deepEqual(snapshot(root), before);
});

test("a target declared through a helper function reports the call site and names the helper", { skip: !hasCmake }, async () => {
  freshCache();
  const root = realpathSync(join(fixtures, "wrapper"));
  const model = await loadProjectModel({ indexFile: (await configure(root)).index, exec: nodeExec });
  const widgets = target(model, "widgets");
  const location = {
    file: join(root, "lib", "CMakeLists.txt"), line: 2, command: "wrapper_add_library",
    helper: { file: join(root, "cmake", "helpers.cmake"), line: 2, command: "add_library" },
  };
  assert.deepEqual(declaringLocation(widgets.sources[0].backtrace, model.sourceRoot), location);
  assert.deepEqual(declaringLocation(widgets.backtrace, model.sourceRoot), location);
  assert.ok(model.cmakeInputs.includes(join(root, "cmake", "helpers.cmake")));
});

test("a FetchContent dependency outside the source root is not a project target", { skip: !hasCmake }, async () => {
  freshCache();
  const top = tempDir();
  const external = join(top, "external");
  const root = join(top, "project");
  mkdirSync(external);
  mkdirSync(root);
  writeFileSync(join(external, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.14)\nproject(ext LANGUAGES CXX)\nadd_library(extlib STATIC ext.cpp)\n");
  writeFileSync(join(external, "ext.cpp"), "int ext() { return 1; }\n");
  writeFileSync(join(root, "CMakeLists.txt"), [
    "cmake_minimum_required(VERSION 3.14)",
    "project(fetch LANGUAGES CXX)",
    "include(FetchContent)",
    `FetchContent_Declare(ext SOURCE_DIR "${external}")`,
    "FetchContent_MakeAvailable(ext)",
    "add_executable(app main.cpp)",
    "target_link_libraries(app PRIVATE extlib)",
    "",
  ].join("\n"));
  writeFileSync(join(root, "main.cpp"), "int main() { return 0; }\n");

  const model = await loadProjectModel({ indexFile: (await configure(root)).index, exec: nodeExec });
  assert.equal(target(model, "extlib").isProjectTarget, false);
  assert.equal(target(model, "app").isProjectTarget, true);
  assert.deepEqual(target(model, "app").dependencies, ["extlib"]);
  assert.ok(!model.cmakeInputs.includes(join(external, "CMakeLists.txt")), model.cmakeInputs.join("\n"));
});

test("a target defined under _deps inside the source root is not a project target", { skip: !hasCmake }, async () => {
  freshCache();
  const root = tempDir();
  mkdirSync(join(root, "_deps", "vendored"), { recursive: true });
  writeFileSync(join(root, "_deps", "vendored", "CMakeLists.txt"), "add_library(vendored STATIC vendored.cpp)\n");
  writeFileSync(join(root, "_deps", "vendored", "vendored.cpp"), "int vendored() { return 1; }\n");
  writeFileSync(join(root, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.14)\nproject(deps LANGUAGES CXX)\nadd_subdirectory(_deps/vendored)\nadd_library(mine STATIC mine.cpp)\n");
  writeFileSync(join(root, "mine.cpp"), "int mine() { return 1; }\n");

  const model = await loadProjectModel({ indexFile: (await configure(root)).index, exec: nodeExec });
  assert.equal(target(model, "vendored").isProjectTarget, false);
  assert.equal(target(model, "mine").isProjectTarget, true);
});

test("glob dependencies from the File API are exposed when CMake reports them", { skip: !hasCmake }, async () => {
  freshCache();
  const cmake = await probeCmake(nodeExec);
  const root = realpathSync(join(fixtures, "glob"));
  const model = await loadProjectModel({ indexFile: (await configure(root)).index, exec: nodeExec });
  assert.deepEqual(sourceNames(target(model, "globbed"), root), ["src/main.cpp"]);
  if (cmake && (cmake.major > 3 || cmake.minor >= 31)) {
    assert.ok(model.globsDependent, "globsDependent present on CMake 3.31+");
    const glob = model.globsDependent.find(g => g.expression === join(root, "src", "*.cpp"));
    assert.ok(glob, JSON.stringify(model.globsDependent));
    assert.equal(glob.recurse, true);
    assert.deepEqual(glob.paths, [join(root, "src", "main.cpp")]);
  }
});

test("missing or partial reply files produce a model error", { skip: !hasCmake }, async () => {
  freshCache();
  const { buildDir, index } = await configure(join(fixtures, "basic"));
  const copy = join(tempDir(), "build");
  cpSync(buildDir, copy, { recursive: true });
  const replyDir = join(copy, ".cmake", "api", "v1", "reply");
  const copiedIndex = join(replyDir, basename(index));

  await assert.rejects(loadProjectModel({ indexFile: join(replyDir, "index-missing.json"), exec: nodeExec }),
    (error: unknown) => error instanceof ProjectModelError && /index-missing\.json/.test(error.message));

  const codemodel = readdirSync(replyDir).find(name => name.startsWith("codemodel-v2-"));
  assert.ok(codemodel);
  const codemodelText = readFileSync(join(replyDir, codemodel), "utf8");
  writeFileSync(join(replyDir, codemodel), codemodelText.slice(0, codemodelText.length / 2));
  await assert.rejects(loadProjectModel({ indexFile: copiedIndex, exec: nodeExec }),
    (error: unknown) => error instanceof ProjectModelError && error.message.includes(codemodel));

  const targetFile = readdirSync(replyDir).find(name => name.startsWith("target-app-"));
  assert.ok(targetFile);
  writeFileSync(join(replyDir, codemodel), codemodelText);
  rmSync(join(replyDir, targetFile));
  await assert.rejects(loadProjectModel({ indexFile: copiedIndex, exec: nodeExec }),
    (error: unknown) => error instanceof ProjectModelError && error.message.includes(targetFile));

  const indexData = JSON.parse(readFileSync(copiedIndex, "utf8"));
  delete indexData.reply["client-pi-cpp-lsp"]["cmakeFiles-v1"];
  writeFileSync(copiedIndex, JSON.stringify(indexData));
  await assert.rejects(loadProjectModel({ indexFile: copiedIndex, exec: nodeExec }),
    (error: unknown) => error instanceof ProjectModelError && error.message.includes("cmakeFiles-v1"));
});
