import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * The CMake projects the user enabled the plugin for, as their real source-root paths. It lives in
 * the plugin's data directory, which survives plugin updates, so a project is enabled once.
 */
export const TRUST_FILE = "trusted.json";

export const trustFile = (dataDir: string) => join(dataDir, TRUST_FILE);

/** The enabled source roots; a missing or unreadable list enables nothing. */
export function readTrusted(dataDir: string | undefined): string[] {
  if (!dataDir) return [];
  try {
    const data = JSON.parse(readFileSync(trustFile(dataDir), "utf8"));
    return Array.isArray(data) ? data.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function isTrusted(dataDir: string | undefined, root: string): boolean {
  return readTrusted(dataDir).includes(root);
}

/** Adds `root` to the list; false when it was already there. Throws when the list cannot be written. */
export function addTrusted(dataDir: string, root: string): boolean {
  const roots = readTrusted(dataDir);
  if (roots.includes(root)) return false;
  mkdirSync(dataDir, { recursive: true });
  // A server reads the list on every call, so it must never see a half-written file.
  const path = trustFile(dataDir);
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify([...roots, root], null, 2)}\n`);
  renameSync(temp, path);
  return true;
}
