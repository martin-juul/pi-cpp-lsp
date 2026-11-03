import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const hasCMakeLists = (dir: string) => existsSync(join(dir, "CMakeLists.txt"));

function parentOf(dir: string): string | undefined {
  const parent = dirname(dir);
  return parent === dir ? undefined : parent;
}

function gitTopLevel(dir: string): string | undefined {
  for (let current: string | undefined = dir; current; current = parentOf(current)) {
    if (existsSync(join(current, ".git"))) return current;
  }
  return undefined;
}

/**
 * Find the CMake source root for a working directory (KTD18): start at `start` or its nearest
 * ancestor with a CMakeLists.txt, then walk up while each parent also has one, stopping at the git
 * top level or the file-system root. Returns the real path, or undefined for a non-CMake directory.
 */
export function findSourceRoot(start: string): string | undefined {
  let current: string | undefined;
  try {
    current = realpathSync(resolve(start));
  } catch {
    return undefined;
  }
  while (current && !hasCMakeLists(current)) current = parentOf(current);
  if (!current) return undefined;
  const gitTop = gitTopLevel(current);
  let root = current;
  while (root !== gitTop) {
    const parent = parentOf(root);
    if (!parent || !hasCMakeLists(parent)) break;
    root = parent;
  }
  return root;
}

function cacheHome(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".cache");
}

/** The managed state directory for a project (KTD2), keyed by a hash of the real source-root path. */
export function projectCacheDir(sourceRoot: string): string {
  const hash = createHash("sha256").update(realpathSync(sourceRoot)).digest("hex").slice(0, 16);
  return join(cacheHome(), "pi-cpp-lsp", hash);
}

/** The managed build directory for a preset, or for configuring without one. */
export function managedBuildDir(sourceRoot: string, preset?: string): string {
  let name = "default";
  if (preset !== undefined) {
    const safe = preset.replace(/[^A-Za-z0-9._-]/g, "_");
    // Distinct preset names must not share a directory after sanitizing.
    name = safe === preset ? `preset-${preset}` : `preset-${safe}-${createHash("sha256").update(preset).digest("hex").slice(0, 8)}`;
  }
  return join(projectCacheDir(sourceRoot), "builds", name);
}

/** The lock file guarding a managed build directory (KTD19). It sits beside the directory, so recreating the directory keeps the lock. */
export function buildLockPath(buildDir: string): string {
  return `${buildDir}.lock`;
}

export interface ProjectState {
  /** The configure preset the user chose for this project. */
  preset?: string;
}

const statePath = (sourceRoot: string) => join(projectCacheDir(sourceRoot), "state.json");

export function readProjectState(sourceRoot: string): ProjectState {
  try {
    const data = JSON.parse(readFileSync(statePath(sourceRoot), "utf8"));
    return typeof data?.preset === "string" ? { preset: data.preset } : {};
  } catch {
    return {};
  }
}

/** Remember the user's preset choice for this project; undefined forgets it. */
export function writeRememberedPreset(sourceRoot: string, preset: string | undefined): void {
  const path = statePath(sourceRoot);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ sourceRoot: realpathSync(sourceRoot), preset }, null, 2)}\n`);
  renameSync(temp, path);
}
