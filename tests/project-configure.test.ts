import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import { ConfigureManager, LOCK_MAX_AGE_MS, probeCmake, resolvePreset, type ConfigureResult, type Exec } from "../extensions/lib/project/configure.ts";
import { buildLockPath, findSourceRoot, managedBuildDir, projectCacheDir, writeRememberedPreset } from "../extensions/lib/project/root.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "cmake");
const configureModule = join(here, "..", "extensions", "lib", "project", "configure.ts");
const hasCmake = spawnSync("cmake", ["--version"]).status === 0;
const hasNinja = spawnSync("ninja", ["--version"]).status === 0;
const hasMake = spawnSync("make", ["--version"]).status === 0;

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

function freshCache(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-cpp-cache-"));
  process.env.XDG_CACHE_HOME = dir;
  return dir;
}

function tempDir(prefix = "pi-cpp-project-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function copyFixture(name: string): string {
  const dir = join(tempDir(), name);
  cpSync(join(fixtures, name), dir, { recursive: true });
  return dir;
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

function cacheValue(buildDir: string, name: string): string | undefined {
  const match = readFileSync(join(buildDir, "CMakeCache.txt"), "utf8").match(new RegExp(`^${name}:[A-Z]+=(.*)$`, "m"));
  return match?.[1];
}

// Count configure runs (cmake -S ...) going through an executor.
function counting(exec: Exec = nodeExec) {
  const runs: string[][] = [];
  const wrapped: Exec = (command, args, options) => {
    if (command === "cmake" && args[0] === "-S") runs.push(args);
    return exec(command, args, options);
  };
  return { exec: wrapped, runs };
}

test("source root is the topmost directory of a contiguous CMakeLists.txt chain within the git top level", () => {
  const top = tempDir();
  const repo = join(top, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "a", "b"), { recursive: true });
  mkdirSync(join(repo, "a", "c", "d"), { recursive: true });
  writeFileSync(join(top, "CMakeLists.txt"), "");
  writeFileSync(join(repo, "CMakeLists.txt"), "");
  writeFileSync(join(repo, "a", "CMakeLists.txt"), "");
  writeFileSync(join(repo, "a", "c", "d", "CMakeLists.txt"), "");

  assert.equal(findSourceRoot(join(repo, "a", "b")), repo);
  assert.equal(findSourceRoot(join(repo, "a")), repo);
  assert.equal(findSourceRoot(join(repo, "a", "c", "d")), join(repo, "a", "c", "d"));
  assert.equal(findSourceRoot(tempDir()), undefined);
});

test("cache directory is keyed by the real source root and stable through a symlink", () => {
  const cache = freshCache();
  const root = tempDir();
  writeFileSync(join(root, "CMakeLists.txt"), "");
  const link = join(tempDir(), "link");
  symlinkSync(root, link);

  assert.equal(findSourceRoot(link), root);
  assert.equal(projectCacheDir(link), projectCacheDir(root));
  assert.ok(projectCacheDir(root).startsWith(join(cache, "pi-cpp-lsp") + "/"));
  assert.notEqual(projectCacheDir(root), projectCacheDir(tempDir()));
});

test("real configure of the basic fixture writes File API replies into the managed directory only", { skip: !hasCmake }, async () => {
  const cache = freshCache();
  const root = join(fixtures, "basic");
  const before = snapshot(root);
  const result = await new ConfigureManager({ root, exec: nodeExec }).trigger();

  assert.equal(result.status, "succeeded", result.output);
  assert.ok(result.buildDir.startsWith(cache), result.buildDir);
  assert.equal(result.preset, undefined);
  assert.ok(result.args.includes("-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"));
  assert.ok(existsSync(join(result.buildDir, "compile_commands.json")));
  assert.equal(cacheValue(result.buildDir, "CMAKE_BUILD_TYPE"), "Debug");
  assert.ok(result.reply.newest?.endsWith(".json"));
  assert.match(result.reply.newest!, /index-[^/]+\.json$/);
  assert.equal(result.reply.newestIsError, false);
  assert.equal(result.reply.newestFromThisRun, true);
  assert.equal(result.reply.lastGood, result.reply.newest);
  const index = JSON.parse(readFileSync(result.reply.newest!, "utf8"));
  const client = index.reply["client-pi-cpp-lsp"];
  assert.ok(client["codemodel-v2"].jsonFile, JSON.stringify(client));
  assert.ok(client["cmakeFiles-v1"].jsonFile, JSON.stringify(client));
  assert.deepEqual(snapshot(root), before);
});

test("preset resolution defaults to a debug preset and remembers the chosen preset", { skip: !hasCmake }, async () => {
  freshCache();
  const root = join(fixtures, "presets");
  const cmake = await probeCmake(nodeExec);
  assert.ok(cmake);

  const first = await resolvePreset(root, nodeExec, cmake);
  assert.equal(first.preset, "debug");
  assert.deepEqual(first.available, ["release", "debug"]);

  writeRememberedPreset(root, "release");
  assert.equal((await resolvePreset(root, nodeExec, cmake)).preset, "release");

  writeRememberedPreset(root, "vanished");
  const fallback = await resolvePreset(root, nodeExec, cmake);
  assert.equal(fallback.preset, "debug");
  assert.ok(fallback.notes.some(note => note.includes("vanished") && note.includes("debug")), fallback.notes.join("\n"));
});

test("a preset with binaryDir is still configured into the managed directory", { skip: !hasCmake }, async () => {
  const cache = freshCache();
  const root = join(fixtures, "presets");
  const before = snapshot(root);
  const result = await new ConfigureManager({ root, exec: nodeExec }).trigger();

  assert.equal(result.status, "succeeded", result.output);
  assert.equal(result.preset, "debug");
  assert.ok(result.args.includes("--preset"));
  assert.ok(result.buildDir.startsWith(cache), result.buildDir);
  assert.equal(cacheValue(result.buildDir, "CMAKE_BUILD_TYPE"), "Debug");
  assert.deepEqual(snapshot(root), before);
  assert.equal(existsSync(join(root, "out")), false);
});

test("an unparsable presets file produces a note and configure proceeds without a preset", { skip: !hasCmake }, async () => {
  freshCache();
  const root = copyFixture("basic");
  writeFileSync(join(root, "CMakePresets.json"), "{ \"version\": 3, ");
  const result = await new ConfigureManager({ root, exec: nodeExec }).trigger();

  assert.equal(result.status, "succeeded", result.output);
  assert.equal(result.preset, undefined);
  assert.ok(result.notes.some(note => note.includes("CMakePresets.json")), result.notes.join("\n"));
});

test("triggers during a run coalesce into exactly one rerun", { skip: !hasCmake }, async () => {
  freshCache();
  const { exec, runs } = counting();
  const manager = new ConfigureManager({ root: join(fixtures, "basic"), exec });
  const first = manager.trigger();
  const second = manager.trigger();
  const third = manager.trigger();
  assert.equal(second, third);

  const [a, b] = await Promise.all([first, second]);
  assert.equal(runs.length, 2);
  assert.equal(a.status, "succeeded", a.output);
  assert.equal(b.status, "succeeded", b.output);
  assert.ok(b.startedAt >= a.finishedAt);
});

test("a deleted source listed in CMakeLists.txt fails configure with a missing finding", { skip: !hasCmake }, async () => {
  freshCache();
  const root = join(fixtures, "missing-source");
  const result = await new ConfigureManager({ root, exec: nodeExec }).trigger();

  assert.equal(result.status, "failed");
  assert.deepEqual(result.missingSources, [{ path: join(root, "gone.cpp"), file: join(root, "CMakeLists.txt"), line: 3 }]);
  // CMake 4 writes an error reply for a failed configure; CMake 3.x writes no reply at all.
  assert.ok(result.reply.newest === undefined || result.reply.newestIsError, JSON.stringify(result.reply));
  assert.equal(result.reply.lastGood, undefined);
  assert.match(result.output, /Cannot find source file/);
});

test("a missing source passed through a helper function is resolved and reported at the calling CMakeLists.txt", { skip: !hasCmake }, async () => {
  freshCache();
  const root = join(fixtures, "wrapper-missing");
  const result = await new ConfigureManager({ root, exec: nodeExec }).trigger();

  assert.equal(result.status, "failed");
  assert.match(result.output, /CMake Error at cmake\/helpers\.cmake:2/);
  assert.deepEqual(result.missingSources, [{ path: join(root, "lib", "gone.cpp"), file: join(root, "lib", "CMakeLists.txt"), line: 2 }]);
});

test("a failing reconfigure after a success keeps the last good reply index and marks the newest as an error", { skip: !hasCmake }, async () => {
  freshCache();
  const root = copyFixture("basic");
  const manager = new ConfigureManager({ root, exec: nodeExec });
  const good = await manager.trigger();
  assert.equal(good.status, "succeeded", good.output);

  rmSync(join(root, "main.cpp"));
  const bad = await manager.trigger();
  assert.equal(bad.status, "failed");
  // CMake 4 writes an error reply from this run; CMake 3.x leaves the good reply as the newest.
  if (bad.reply.newestIsError) assert.equal(bad.reply.newestFromThisRun, true);
  else assert.deepEqual([bad.reply.newest, bad.reply.newestFromThisRun], [good.reply.newest, false]);
  assert.equal(bad.reply.lastGood, good.reply.newest);
  assert.ok(existsSync(bad.reply.lastGood!));
  assert.deepEqual(bad.missingSources, [{ path: join(root, "main.cpp"), file: join(root, "CMakeLists.txt"), line: 3 }]);
});

test("a missing required package reports failure with CMake's message", { skip: !hasCmake }, async () => {
  freshCache();
  const result = await new ConfigureManager({ root: join(fixtures, "broken"), exec: nodeExec }).trigger();

  assert.equal(result.status, "failed");
  assert.match(result.output, /DoesNotExist/);
  assert.deepEqual(result.missingSources, []);
});

test("an existing managed directory keeps its cached generator after Ninja appears on PATH", { skip: !hasCmake || !hasMake }, async () => {
  freshCache();
  const root = join(fixtures, "basic");
  let ninjaVisible = false;
  const exec: Exec = (command, args, options) => command === "ninja" && !ninjaVisible
    ? Promise.resolve({ stdout: "", stderr: "", code: 127, killed: false })
    : nodeExec(command, args, options);

  const first = await new ConfigureManager({ root, exec }).trigger();
  assert.equal(first.status, "succeeded", first.output);
  assert.equal(first.generator, "Unix Makefiles");

  ninjaVisible = true;
  const second = await new ConfigureManager({ root, exec }).trigger();
  assert.equal(second.status, "succeeded", second.output);
  assert.equal(second.generator, "Unix Makefiles");
  assert.equal(cacheValue(second.buildDir, "CMAKE_GENERATOR"), "Unix Makefiles");
});

test("a preset that changes its explicit generator gets a recreated managed directory", { skip: !hasCmake || !hasMake || !hasNinja }, async () => {
  freshCache();
  const root = copyFixture("presets");
  const presets = (generator: string) => JSON.stringify({
    version: 3,
    configurePresets: [{ name: "debug", generator, cacheVariables: { CMAKE_BUILD_TYPE: "Debug" } }],
  });
  writeFileSync(join(root, "CMakePresets.json"), presets("Ninja"));
  const first = await new ConfigureManager({ root, exec: nodeExec }).trigger();
  assert.equal(first.status, "succeeded", first.output);
  assert.equal(first.generator, "Ninja");
  writeFileSync(join(first.buildDir, "marker"), "");

  writeFileSync(join(root, "CMakePresets.json"), presets("Unix Makefiles"));
  const second = await new ConfigureManager({ root, exec: nodeExec }).trigger();
  assert.equal(second.status, "succeeded", second.output);
  assert.equal(second.buildDir, first.buildDir);
  assert.equal(cacheValue(second.buildDir, "CMAKE_GENERATOR"), "Unix Makefiles");
  assert.equal(existsSync(join(second.buildDir, "marker")), false);
});

test("CMake 3.14 to 3.18 ignores preset files and notes that presets need 3.19", { skip: !hasCmake }, async () => {
  freshCache();
  const calls: string[][] = [];
  const exec: Exec = (command, args, options) => {
    calls.push([command, ...args]);
    if (command === "cmake" && args[0] === "--version") {
      return Promise.resolve({ stdout: "cmake version 3.18.4\n\nCMake suite maintained and supported by Kitware (kitware.com/cmake).\n", stderr: "", code: 0, killed: false });
    }
    return nodeExec(command, args, options);
  };
  const result = await new ConfigureManager({ root: join(fixtures, "presets"), exec }).trigger();

  assert.equal(result.status, "succeeded", result.output);
  assert.equal(result.preset, undefined);
  assert.equal(result.args.includes("--preset"), false);
  assert.ok(result.notes.some(note => note.includes("presets need CMake 3.19")), result.notes.join("\n"));
  assert.equal(calls.some(call => call.some(arg => arg.startsWith("--list-presets"))), false);
});

test("aborting during configure kills the process and reports cancellation", { skip: !hasCmake }, async () => {
  freshCache();
  const root = tempDir();
  writeFileSync(join(root, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.14)\nproject(slow NONE)\nexecute_process(COMMAND ${CMAKE_COMMAND} -E sleep 30 OUTPUT_QUIET ERROR_QUIET)\n");
  const controller = new AbortController();
  const exec: Exec = (command, args, options) => {
    if (command === "cmake" && args[0] === "-S") setTimeout(() => controller.abort(), 300);
    return nodeExec(command, args, options);
  };
  const started = Date.now();
  const result = await new ConfigureManager({ root, exec, signal: controller.signal }).trigger();

  assert.equal(result.status, "cancelled");
  assert.ok(Date.now() - started < 10_000);
  assert.match(result.output, /cancelled/);
});

// Run a ConfigureManager in a separate process. Its configure step announces itself and is held for holdMs.
function childConfigure(root: string, cache: string, holdMs: number) {
  const script = join(tempDir("pi-cpp-child-"), "child.mjs");
  writeFileSync(script, `
import { spawn } from "node:child_process";
import { ConfigureManager } from ${JSON.stringify(configureModule)};
const exec = (command, args, options = {}) => new Promise(resolve => {
  let stdout = "", stderr = "";
  const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", d => { stdout += d; });
  child.stderr.on("data", d => { stderr += d; });
  child.on("error", () => resolve({ stdout, stderr, code: 127, killed: false }));
  child.on("close", code => resolve({ stdout, stderr, code: code ?? 1, killed: false }));
});
const held = async (command, args, options) => {
  if (command === "cmake" && args[0] === "-S") {
    console.log("configuring");
    await new Promise(resolve => setTimeout(resolve, ${holdMs}));
  }
  return exec(command, args, options);
};
const result = await new ConfigureManager({ root: process.argv[2], exec: held }).trigger();
console.log(JSON.stringify({ status: result.status }));
`);
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", script, root], {
    env: { ...process.env, XDG_CACHE_HOME: cache },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let stdout = "";
  const configuring = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", data => {
      stdout += data;
      if (stdout.includes("configuring")) resolve();
    });
    child.on("exit", () => reject(new Error(`child exited before configuring: ${stdout}`)));
  });
  const exited = new Promise<string>(resolve => child.on("close", () => resolve(stdout)));
  return { child, configuring, exited };
}

test("a live lock makes a second session wait and reuse the replies", { skip: !hasCmake }, async () => {
  const cache = freshCache();
  const root = join(fixtures, "basic");
  const other = childConfigure(root, cache, 1_500);
  await other.configuring;

  const { exec, runs } = counting();
  const result: ConfigureResult = await new ConfigureManager({ root, exec }).trigger();
  const childOutput = await other.exited;

  assert.match(childOutput, /"status":"succeeded"/);
  assert.equal(runs.length, 0);
  assert.equal(result.status, "succeeded", result.output);
  assert.equal(result.reusedFromOtherSession, true);
  assert.equal(result.reply.newestIsError, false);
  assert.ok(result.reply.newest && existsSync(result.reply.newest));
  assert.ok(statSync(result.reply.newest).mtimeMs >= result.startedAt);
});

test("a stale lock left by a dead process is taken over", { skip: !hasCmake }, async () => {
  const cache = freshCache();
  const root = join(fixtures, "basic");
  const other = childConfigure(root, cache, 60_000);
  await other.configuring;
  other.child.kill("SIGKILL");
  await other.exited;
  assert.ok(existsSync(buildLockPath(managedBuildDir(root))));

  const { exec, runs } = counting();
  const result = await new ConfigureManager({ root, exec }).trigger();
  assert.equal(result.status, "succeeded", result.output);
  assert.equal(result.reusedFromOtherSession, false);
  assert.equal(runs.length, 1);
});

// A lock left by a crashed pi whose PID now belongs to a live process (here: this test process).
function writeLiveLock(root: string, startedAt: number): string {
  const buildDir = managedBuildDir(root);
  mkdirSync(dirname(buildDir), { recursive: true });
  const lockPath = buildLockPath(buildDir);
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt }));
  return lockPath;
}

test("a lock older than any configure can take is taken over even when its PID is alive", { skip: !hasCmake, timeout: 30_000 }, async () => {
  freshCache();
  const root = join(fixtures, "basic");
  const lockPath = writeLiveLock(root, Date.now() - LOCK_MAX_AGE_MS - 60_000);

  const { exec, runs } = counting();
  const result = await new ConfigureManager({ root, exec }).trigger();
  assert.equal(result.status, "succeeded", result.output);
  assert.equal(result.reusedFromOtherSession, false);
  assert.equal(runs.length, 1);
  assert.equal(existsSync(lockPath), false, "the run releases the lock it took");
});

test("a waiting session takes over a live-PID lock once it outlives any configure", { skip: !hasCmake, timeout: 30_000 }, async () => {
  freshCache();
  const root = join(fixtures, "basic");
  writeLiveLock(root, Date.now() - LOCK_MAX_AGE_MS + 1_000);

  const { exec, runs } = counting();
  const started = Date.now();
  const result = await new ConfigureManager({ root, exec }).trigger();
  assert.equal(result.status, "succeeded", result.output);
  assert.equal(result.reusedFromOtherSession, false);
  assert.equal(runs.length, 1);
  assert.ok(Date.now() - started >= 800, "it waited while the lock was still young enough to be live");
});
