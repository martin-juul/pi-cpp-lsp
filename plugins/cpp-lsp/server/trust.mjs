import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);

// ../../packages/core/src/project/root.ts
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// ../../packages/core/src/harness.ts
var PI = {
  notePrefix: "pi-cpp-lsp:",
  presetCommand: "/cpp-preset",
  logName: "pi-cpp-lsp",
  cacheName: "pi-cpp-lsp"
};
var harness = { ...PI };

// ../../packages/core/src/project/root.ts
var hasCMakeLists = (dir) => existsSync(join(dir, "CMakeLists.txt"));
function parentOf(dir) {
  const parent = dirname(dir);
  return parent === dir ? void 0 : parent;
}
function gitTopLevel(dir) {
  for (let current = dir; current; current = parentOf(current)) {
    if (existsSync(join(current, ".git"))) return current;
  }
  return void 0;
}
function findSourceRoot(start) {
  let current;
  try {
    current = realpathSync(resolve(start));
  } catch {
    return void 0;
  }
  while (current && !hasCMakeLists(current)) current = parentOf(current);
  if (!current) return void 0;
  const gitTop = gitTopLevel(current);
  let root = current;
  while (root !== gitTop) {
    const parent = parentOf(root);
    if (!parent || !hasCMakeLists(parent)) break;
    root = parent;
  }
  return root;
}

// src/runtime.ts
import { realpathSync as realpathSync2 } from "node:fs";
import { fileURLToPath } from "node:url";
var TRUST_COMMAND = "/cpp-lsp:trust";
var UNTRUSTED = {
  reason: "the cpp-lsp plugin is not enabled for it, and configuring it would run the project's CMake code",
  steps: `run ${TRUST_COMMAND}`,
  // Enabling takes effect in the running session, unlike pi's trust, which needs a restart.
  until: "until you enable the plugin here"
};
function isEntry(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync2(entry) === realpathSync2(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// src/trust.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { randomUUID } from "node:crypto";
var TRUST_FILE = "trusted.json";
var trustFile = (dataDir) => join2(dataDir, TRUST_FILE);
function readTrusted(dataDir) {
  if (!dataDir) return [];
  try {
    const data = JSON.parse(readFileSync2(trustFile(dataDir), "utf8"));
    return Array.isArray(data) ? data.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
function addTrusted(dataDir, root) {
  const roots = readTrusted(dataDir);
  if (roots.includes(root)) return false;
  mkdirSync2(dataDir, { recursive: true });
  const path = trustFile(dataDir);
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync2(temp, `${JSON.stringify([...roots, root], null, 2)}
`);
  renameSync2(temp, path);
  return true;
}

// src/bin/trust.ts
function trustReport(projectDir, dataDir) {
  if (!projectDir) return "cpp-lsp could not tell which project to enable: Claude Code passed no project directory.";
  const root = findSourceRoot(projectDir);
  if (!root) return `${projectDir} is not a CMake project: no CMakeLists.txt was found in it or its parent directories, so there is nothing for cpp-lsp to enable.`;
  if (!dataDir) return `cpp-lsp could not enable ${root}: Claude Code passed no plugin data directory to remember it in.`;
  try {
    if (!addTrusted(dataDir, root)) return `cpp-lsp is already enabled for ${root}.`;
  } catch (error) {
    return `cpp-lsp could not enable ${root}: writing ${trustFile(dataDir)} failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  return `cpp-lsp is now enabled for ${root}. It configures the project with CMake in its own cache, and the next prompt carries the project briefing. New sessions in this project start enabled.`;
}
if (isEntry(import.meta.url)) {
  const [projectDir, dataDir] = process.argv.slice(2);
  try {
    console.log(trustReport(projectDir || process.env.CLAUDE_PROJECT_DIR, dataDir || process.env.CLAUDE_PLUGIN_DATA));
  } catch (error) {
    console.log(`cpp-lsp could not enable the project: ${error instanceof Error ? error.message : String(error)}`);
  }
}
export {
  trustReport
};
