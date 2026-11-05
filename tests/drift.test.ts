import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import type { Exec } from "../packages/core/src/exec.ts";
import { ConfigureManager } from "../packages/core/src/project/configure.ts";
import {
  DRIFT_SKIPPED_MESSAGE, FindingsLedger, scanDrift,
  type DriftFinding, type DriftReport, type MissingFinding, type UnregisteredFinding,
} from "../packages/core/src/project/drift.ts";
import { loadProjectModel, type ProjectModel } from "../packages/core/src/project/model.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "cmake");
const hasCmake = spawnSync("cmake", ["--version"]).status === 0;
const hasGit = spawnSync("git", ["--version"]).status === 0;

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

function copyFixture(name: string): string {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-drift-"))), name);
  cpSync(join(fixtures, name), root, { recursive: true });
  return root;
}

function write(root: string, path: string, text = "int x() { return 0; }\n"): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function git(root: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function gitInit(root: string): void {
  git(root, "init", "-q");
  git(root, "add", "-A");
}

interface Project {
  root: string;
  manager: ConfigureManager;
  model: ProjectModel;
}

async function configure(manager: ConfigureManager): Promise<ProjectModel> {
  const result = await manager.trigger();
  assert.equal(result.status, "succeeded", result.output);
  return loadProjectModel({ indexFile: result.reply.lastGood!, exec: nodeExec });
}

async function project(fixture: string): Promise<Project> {
  freshCache();
  const root = copyFixture(fixture);
  const manager = new ConfigureManager({ root, exec: nodeExec });
  return { root, manager, model: await configure(manager) };
}

const scan = (p: Project, model: ProjectModel | undefined = p.model) => scanDrift({ root: p.root, model, exec: nodeExec });

// Findings with project-relative paths, for readable comparisons.
function rel(root: string, findings: readonly DriftFinding[]): unknown[] {
  return findings.map(finding => {
    if (finding.kind === "missing") {
      return { kind: "missing", path: relative(root, finding.path), targets: finding.targets, at: finding.location && `${relative(root, finding.location.file)}:${finding.location.line}` };
    }
    return {
      kind: "unregistered", path: relative(root, finding.path), uncovered: finding.uncovered, likelyGlob: finding.likelyGlob,
      candidates: finding.candidates.map(c => `${c.target}@${c.location ? `${relative(root, c.location.file)}:${c.location.line}` : "?"}`),
    };
  });
}

test("a new source next to target net is unregistered and points to its target_sources line (AE1)", { skip: !hasCmake || !hasGit }, async () => {
  const p = await project("drift");
  write(p.root, ".gitignore", "ignored/\n");
  gitInit(p.root);
  write(p.root, "src/net/socket.cpp");

  const report = await scan(p);
  assert.equal(report.mode, "git");
  assert.equal(report.skipped, undefined);
  assert.deepEqual(rel(p.root, report.findings), [
    { kind: "unregistered", path: "src/net/socket.cpp", uncovered: false, likelyGlob: false, candidates: ["net@src/net/CMakeLists.txt:2"] },
  ]);
  const finding = report.findings[0] as UnregisteredFinding;
  assert.equal(finding.candidates[0].location?.command, "target_sources");
  assert.deepEqual(report.referenced, []);

  // pi adds the file to the target_sources call; after the reconfigure the finding resolves (AE5).
  const ledger = new FindingsLedger();
  ledger.update(report);
  write(p.root, "src/net/CMakeLists.txt", "add_library(net STATIC)\ntarget_sources(net PRIVATE connection.cpp socket.cpp)\n");
  const delta = ledger.update(await scan(p, await configure(p.manager)));
  assert.deepEqual([delta.new, delta.resolved, delta.open], [[], [finding], []]);
});

test("headers, build directories, dependency directories and ignored paths are never candidates", { skip: !hasCmake || !hasGit }, async () => {
  const p = await project("drift");
  write(p.root, ".gitignore", "ignored/\n");
  // An un-ignored in-tree build directory holds CMake's own generated .cpp files.
  const inTree = spawnSync("cmake", ["-S", p.root, "-B", join(p.root, "build")], { encoding: "utf8" });
  assert.equal(inTree.status, 0, inTree.stdout + inTree.stderr);
  write(p.root, "src/net/socket.h");
  write(p.root, "build/extra.cpp");
  write(p.root, "cmake-build-debug/x.cpp");
  write(p.root, "out/x.cpp");
  write(p.root, "stage/CMakeCache.txt", "");
  write(p.root, "stage/x.cpp");
  write(p.root, "_deps/vendored/x.cpp");
  write(p.root, "ignored/x.cpp");
  // A file whose own name matches a build-directory pattern is still a candidate.
  write(p.root, "src/net/build.cpp");
  gitInit(p.root);

  const report = await scan(p);
  assert.equal(report.mode, "git");
  assert.deepEqual(rel(p.root, report.findings).map(f => (f as { path: string }).path), ["src/net/build.cpp"]);
});

test("outside a git repository the file-system walk finds the same candidates and skips build directories", { skip: !hasCmake || !hasGit }, async () => {
  const p = await project("drift");
  write(p.root, "src/net/socket.cpp");
  write(p.root, "src/util/extra.c");
  write(p.root, "build-release/x.cpp");
  write(p.root, "stage/CMakeCache.txt", "");
  write(p.root, "stage/y.cxx");
  write(p.root, "src/util/notes.txt", "");

  gitInit(p.root);
  const viaGit = await scan(p);
  rmSync(join(p.root, ".git"), { recursive: true, force: true });
  const viaWalk = await scan(p);

  assert.equal(viaGit.mode, "git");
  assert.equal(viaWalk.mode, "walk");
  assert.deepEqual(viaWalk.findings, viaGit.findings);
  assert.deepEqual(rel(p.root, viaWalk.findings).map(f => (f as { path: string }).path), ["src/net/socket.cpp", "src/util/extra.c"]);
});

test("a deleted listed source is missing with its listing line, from the model and from a failed configure (AE2)", { skip: !hasCmake }, async () => {
  const p = await project("drift");
  rmSync(join(p.root, "src", "util", "old.cpp"));
  const expected = [{ kind: "missing", path: "src/util/old.cpp", targets: ["util"], at: "src/util/CMakeLists.txt:1" }];

  const fromModel = await scan(p);
  assert.deepEqual(rel(p.root, fromModel.findings), expected);
  assert.equal((fromModel.findings[0] as MissingFinding).location?.command, "add_library");

  const failed = await p.manager.trigger();
  assert.equal(failed.status, "failed");
  const both = await scanDrift({ root: p.root, model: p.model, missingSources: failed.missingSources, exec: nodeExec });
  assert.deepEqual(rel(p.root, both.findings), expected);

  // With no good model at all, the failed configure alone still yields the finding.
  const configureOnly = await scanDrift({ root: p.root, missingSources: failed.missingSources, exec: nodeExec });
  assert.deepEqual(rel(p.root, configureOnly.findings), [{ ...expected[0], targets: [] }]);
  assert.ok(configureOnly.skipped);
});

test("git mv of a source yields one unregistered and one missing finding (AE3)", { skip: !hasCmake || !hasGit }, async () => {
  const p = await project("drift");
  gitInit(p.root);
  mkdirSync(join(p.root, "src", "core"));
  git(p.root, "mv", "src/a.cpp", "src/core/a.cpp");

  const report = await scan(p);
  assert.deepEqual(rel(p.root, report.findings), [
    { kind: "missing", path: "src/a.cpp", targets: ["app"], at: "CMakeLists.txt:6" },
    { kind: "unregistered", path: "src/core/a.cpp", uncovered: false, likelyGlob: false, candidates: ["app@CMakeLists.txt:6"] },
  ]);
});

test("two targets tied in a directory are both listed as candidates", { skip: !hasCmake }, async () => {
  const p = await project("drift");
  write(p.root, "src/tie/gamma.cpp");
  const report = await scan(p);
  assert.deepEqual(rel(p.root, report.findings), [
    { kind: "unregistered", path: "src/tie/gamma.cpp", uncovered: false, likelyGlob: false, candidates: ["alpha@src/tie/CMakeLists.txt:1", "beta@src/tie/CMakeLists.txt:2"] },
  ]);
});

test("a source in a directory no target covers needs a new target, and absent generated sources are not missing", { skip: !hasCmake }, async () => {
  const p = await project("multi");
  write(p.root, "tools/gen.cpp");
  // The multi fixture's generated.cpp is produced at build time and does not exist yet.
  assert.ok(p.model.targets.some(t => t.sources.some(s => s.isGenerated && s.path.endsWith("generated.cpp"))));

  const report = await scan(p);
  assert.deepEqual(rel(p.root, report.findings), [
    { kind: "unregistered", path: "tools/gen.cpp", uncovered: true, likelyGlob: false, candidates: [] },
  ]);
});

test("a source under a glob is likely-glob and resolves after a reconfigure (AE4)", { skip: !hasCmake }, async () => {
  const p = await project("glob");
  const ledger = new FindingsLedger();
  write(p.root, "src/app/new.cpp");

  const before = await scan(p);
  assert.deepEqual(rel(p.root, before.findings), [
    { kind: "unregistered", path: "src/app/new.cpp", uncovered: false, likelyGlob: true, candidates: ["globbed@CMakeLists.txt:4"] },
  ]);
  assert.deepEqual(ledger.update(before).new.map(f => f.path), [join(p.root, "src", "app", "new.cpp")]);

  const after = await scan(p, await configure(p.manager));
  assert.deepEqual(after.findings, []);
  const delta = ledger.update(after);
  assert.deepEqual(delta.resolved.map(f => f.path), [join(p.root, "src", "app", "new.cpp")]);
  assert.deepEqual([delta.new, delta.open], [[], []]);

  // Without CONFIGURE_DEPENDS CMake reports no glob dependency; the file(GLOB text still marks it.
  write(p.root, "CMakeLists.txt", [
    "cmake_minimum_required(VERSION 3.14)",
    "project(glob LANGUAGES CXX)",
    "file(GLOB_RECURSE GLOB_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp)",
    "add_executable(globbed ${GLOB_SOURCES})",
    "",
  ].join("\n"));
  const plain = await configure(p.manager);
  assert.ok(!plain.globsDependent?.length);
  write(p.root, "src/other.cpp");
  const heuristic = await scan(p, plain);
  assert.deepEqual(rel(p.root, heuristic.findings), [
    { kind: "unregistered", path: "src/other.cpp", uncovered: false, likelyGlob: true, candidates: ["globbed@CMakeLists.txt:4"] },
  ]);
});

test("a source referenced only under an inactive condition is reported as referenced, not unregistered", { skip: !hasCmake }, async () => {
  const p = await project("gated");
  // Same file name as a registered source, but a different file: still unregistered.
  write(p.root, "tools/main.cpp");

  const report = await scan(p);
  assert.deepEqual(rel(p.root, report.findings), [
    { kind: "unregistered", path: "tools/main.cpp", uncovered: false, likelyGlob: false, candidates: ["app@CMakeLists.txt:4"] },
  ]);
  assert.deepEqual(report.referenced.map(r => [relative(p.root, r.path), relative(p.root, r.file), r.line]), [
    ["extra/feature.cpp", "CMakeLists.txt", 9],
    ["platform/win_console.cpp", "CMakeLists.txt", 6],
  ]);

  const ledger = new FindingsLedger();
  const delta = ledger.update(report);
  assert.deepEqual(delta.new.map(f => relative(p.root, f.path)), ["tools/main.cpp"]);
  assert.deepEqual(delta.open.map(f => relative(p.root, f.path)), ["tools/main.cpp"]);
});

test("a new file sharing a basename with a directory-variable or literal reference elsewhere is still unregistered", { skip: !hasCmake }, async () => {
  // gated lists ${CMAKE_CURRENT_SOURCE_DIR}/extra/feature.cpp, which is the root's extra/, not tools/extra/.
  const gated = await project("gated");
  write(gated.root, "tools/extra/feature.cpp");
  const gatedReport = await scan(gated);
  assert.deepEqual(rel(gated.root, gatedReport.findings).map((f: any) => [f.kind, f.path]), [["unregistered", "tools/extra/feature.cpp"]]);
  assert.deepEqual(gatedReport.referenced.map(r => relative(gated.root, r.path)), ["extra/feature.cpp", "platform/win_console.cpp"]);

  // src/net/CMakeLists.txt lists connection.cpp, which CMake resolves in src/net/, never at the root.
  const drift = await project("drift");
  write(drift.root, "connection.cpp");
  const driftReport = await scan(drift);
  assert.deepEqual(rel(drift.root, driftReport.findings).map((f: any) => [f.kind, f.path]), [["unregistered", "connection.cpp"]]);
  assert.deepEqual(driftReport.referenced, []);
});

// ---------------------------------------------------------------------------
// Without real tools

const emptyModel = (root: string): ProjectModel => ({
  sourceRoot: root, buildDir: join(root, "nonexistent-build"), indexFile: "", cmakeVersion: "4.4.4", configuration: "Debug",
  targets: [], cmakeInputs: [], notes: [],
});

test("a scan that runs past two seconds is skipped with an explicit message", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-cpp-drift-")));
  write(root, "a.cpp");
  // A git that never answers until it is killed.
  const hangingExec: Exec = (_command, _args, options = {}) => new Promise<ExecResult>(resolve => {
    const done = () => resolve({ stdout: "", stderr: "", code: 1, killed: true });
    options.signal?.addEventListener("abort", done, { once: true });
    if (options.timeout) setTimeout(done, options.timeout).unref();
  });
  const started = Date.now();
  const report = await scanDrift({ root, model: emptyModel(root), exec: hangingExec });
  const elapsed = Date.now() - started;
  assert.equal(report.skipped, DRIFT_SKIPPED_MESSAGE);
  assert.deepEqual(report.findings, []);
  assert.ok(elapsed >= 1900 && elapsed < 4000, `${elapsed} ms`);
});

const unregistered = (path: string): UnregisteredFinding => ({ kind: "unregistered", path, candidates: [{ target: "net" }], uncovered: false, likelyGlob: false });
const missing = (path: string): MissingFinding => ({ kind: "missing", path, targets: ["net"] });
const report = (findings: DriftFinding[], skipped?: string): DriftReport => ({ findings, referenced: [], ...(skipped ? { skipped } : {}) });

test("the ledger emits each finding once as new and once as resolved", () => {
  const ledger = new FindingsLedger();
  const a = unregistered("/p/a.cpp");
  const b = missing("/p/b.cpp");

  let delta = ledger.update(report([a, b]));
  assert.deepEqual([delta.new, delta.resolved, delta.open], [[a, b], [], [a, b]]);

  delta = ledger.update(report([b, a]));
  assert.deepEqual([delta.new, delta.resolved], [[], []]);
  assert.deepEqual(delta.open, [a, b]);

  // The same path under a different kind is a different finding.
  const aMissing = missing("/p/a.cpp");
  delta = ledger.update(report([aMissing, b]));
  assert.deepEqual([delta.new, delta.resolved], [[aMissing], [a]]);

  delta = ledger.update(report([]));
  assert.deepEqual([delta.new, delta.resolved, delta.open], [[], [aMissing, b], []]);
  delta = ledger.update(report([]));
  assert.deepEqual([delta.new, delta.resolved, delta.open], [[], [], []]);
});

test("a skipped scan keeps unregistered findings open instead of resolving them", () => {
  const ledger = new FindingsLedger();
  const a = unregistered("/p/a.cpp");
  const b = missing("/p/b.cpp");
  ledger.update(report([a, b]));

  const delta = ledger.update(report([], DRIFT_SKIPPED_MESSAGE));
  assert.deepEqual([delta.new, delta.resolved, delta.open], [[], [b], [a]]);
});
