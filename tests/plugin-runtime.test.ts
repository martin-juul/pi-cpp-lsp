import assert from "node:assert/strict";
import test from "node:test";
import { nodeExec } from "../plugins/cpp-lsp/src/runtime.ts";

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

test("nodeExec stops a program at its timeout even when a background process holds the pipe", async () => {
  const started = Date.now();
  const result = await nodeExec("sh", sh("sleep 5 & echo started; sleep 5"), { timeout: 300 });
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.equal(result.killed, true);
  assert.equal(result.stdout, "started\n");
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
