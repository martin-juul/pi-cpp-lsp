import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { logFileName, projectLog } from "../packages/core/src/log.ts";
import { projectCacheDir } from "../packages/core/src/project/root.ts";

test("the project log appends timestamped lines in the managed cache, never in the project tree", t => {
  const previous = process.env.XDG_CACHE_HOME;
  const cache = mkdtempSync(join(tmpdir(), "pi-log-cache-"));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-log-project-")));
  process.env.XDG_CACHE_HOME = cache;
  t.after(() => {
    if (previous === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previous;
    rmSync(cache, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });
  const log = projectLog(root);
  log("first");
  log("second");
  assert.equal(logFileName(), "pi-cpp-lsp.log");
  const file = join(projectCacheDir(root), logFileName());
  const lines = readFileSync(file, "utf8").trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^\d{4}-\d\d-\d\dT\S+Z first$/);
  assert.match(lines[1]!, / second$/);
  assert.ok(!existsSync(join(root, logFileName())));
  // A log past its cap keeps its newer half.
  writeFileSync(file, `${"old line\n".repeat(70_000)}`);
  log("newest");
  const kept = readFileSync(file, "utf8");
  assert.ok(kept.length < 400_000);
  assert.match(kept, / newest\n$/);
});
