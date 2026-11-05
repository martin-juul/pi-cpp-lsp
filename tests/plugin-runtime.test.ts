import assert from "node:assert/strict";
import test from "node:test";
import { nodeExec, stopRunning } from "../plugins/cpp-lsp/src/runtime.ts";

const sh = (script: string) => ["-c", script];

test("nodeExec returns the output and exit code, and a program that cannot start as code 127", async () => {
  assert.deepEqual(await nodeExec("sh", sh("echo out; echo err >&2; exit 3")), { stdout: "out\n", stderr: "err\n", code: 3, killed: false });
  const missing = await nodeExec("cpp-lsp-no-such-program", []);
  assert.equal(missing.code, 127);
  assert.equal(missing.killed, false);
});

test("nodeExec ends a run whose background process keeps the output pipe open", async () => {
  // The background sleep inherits stdout and outlives the shell by seconds.
  const started = Date.now();
  const result = await nodeExec("sh", sh("sleep 5 & echo started"));
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.deepEqual(result, { stdout: "started\n", stderr: "", code: 0, killed: false });
});

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function gone(pid: number): Promise<boolean> {
  for (const deadline = Date.now() + 2000; Date.now() < deadline; await new Promise(done => setTimeout(done, 20))) {
    if (!alive(pid)) return true;
  }
  return false;
}

test("nodeExec stops a program at its timeout, together with the processes it started", async () => {
  const started = Date.now();
  const result = await nodeExec("sh", sh("sleep 30 & echo $!; sleep 30"), { timeout: 300 });
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.equal(result.killed, true);
  const background = Number(result.stdout.trim());
  assert.ok(background > 0, result.stdout);
  assert.ok(await gone(background), "the background sleep was stopped with its parent");
});

test("stopRunning stops every running program, with SIGKILL for one that ignores SIGTERM", async () => {
  const stubborn = nodeExec("sh", sh("trap '' TERM; sleep 30"));
  const plain = nodeExec("sleep", ["30"]);
  await new Promise(done => setTimeout(done, 100));
  const started = Date.now();
  await stopRunning(300);
  const results = await Promise.all([stubborn, plain]);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  for (const result of results) assert.notEqual(result.code, 0);
  await stopRunning(300);
});

test("nodeExec stops a program when the call is aborted", async () => {
  const controller = new AbortController();
  const running = nodeExec("sleep", ["5"], { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  const started = Date.now();
  const result = await running;
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.equal(result.killed, true);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal((await nodeExec("sleep", ["5"], { signal: aborted.signal })).killed, true);
});

test("nodeExec keeps output that arrives just after the program exits", async () => {
  // The background writer finishes after the shell exits, inside the idle grace for each chunk.
  const result = await nodeExec("sh", sh("(for i in 1 2 3; do sleep 0.05; echo $i; done) & echo main"));
  assert.equal(result.stdout, "main\n1\n2\n3\n");
});
