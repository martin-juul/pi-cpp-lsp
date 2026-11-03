import { dirname, isAbsolute, relative } from "node:path";
import type { ConfigureResult } from "./configure.ts";
import type { DriftFinding, ReferencedSource } from "./drift.ts";
import { formatStandard, ownersOf, type ProjectModel, type ProjectTarget } from "./model.ts";

/** The briefing stays within this many characters (R7); larger projects get the summary form. */
export const BRIEFING_BUDGET = 4_000;
const ERROR_EXCERPT_CHARS = 1_500;
const MAX_LISTED_DIRS = 3;

export type ProjectStatus = "non-cmake" | "configuring" | "ready" | "failed";

export interface BriefingInput {
  root: string;
  status: ProjectStatus;
  /** The current model, or the last good one after a failed configure (KTD22). */
  model?: ProjectModel;
  /** The last finished configure. */
  result?: ConfigureResult;
  /** Why the replies of a finished configure could not be read. */
  modelError?: string;
  /** Every open drift finding. */
  findings: readonly DriftFinding[];
  /** Sources referenced in CMake but not built in this configuration. */
  referenced: readonly ReferencedSource[];
  /** Why unregistered files were not checked. */
  skipped?: string;
}

/** A path relative to the source root, or absolute when it lies outside. */
export function displayPath(root: string, path: string): string {
  const rel = relative(root, path);
  if (rel === "") return ".";
  return rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}

const at = (root: string, file: string, line: number) => `${displayPath(root, file)}:${line}`;

// ---------------------------------------------------------------------------
// Findings

export interface FindingTextOptions {
  /** A reconfigure ran for this likely-glob file and did not register it. */
  globRechecked?: boolean;
}

/** One line describing an open finding, naming the file and line to edit (R10, R11). */
export function describeFinding(finding: DriftFinding, root: string, options: FindingTextOptions = {}): string {
  const path = displayPath(root, finding.path);
  if (finding.kind === "missing") {
    const by = finding.targets.length > 0 ? ` by ${finding.targets.join(", ")}` : "";
    const where = finding.location ? ` at ${at(root, finding.location.file, finding.location.line)}` : "";
    return `${path} is missing on disk but listed${by}${where}; remove it from the list or restore the file.`;
  }
  if (finding.uncovered) {
    return `${path} is in no target, and no CMakeLists.txt covers ${displayPath(root, dirname(finding.path))}; add a target or an add_subdirectory for it.`;
  }
  const places = finding.candidates.map(candidate => {
    const location = candidate.location;
    if (!location) return candidate.target;
    let text = `${candidate.target} at ${at(root, location.file, location.line)}${location.command ? ` (${location.command})` : ""}`;
    if (location.helper?.line !== undefined) {
      text += ` via ${location.helper.command ?? "a helper"} in ${at(root, location.helper.file, location.helper.line)}; edit the call, not the helper`;
    }
    return text;
  });
  const owner = finding.candidates.length > 1 ? `Likely owners (tie): ${places.join("; ")}` : `Likely owner: ${places[0]}`;
  const glob = finding.likelyGlob
    ? options.globRechecked ? " Its target uses file(GLOB), but a reconfigure did not register it, so edit the source list." : " Its target uses file(GLOB), but the configure did not register it."
    : "";
  return `${path} is in no target. ${owner}; add it ${finding.candidates.length > 1 ? "to the one it belongs to" : "there"}.${glob}`;
}

/** One line for a finding that no longer holds. */
export function describeResolved(finding: DriftFinding, root: string, model: ProjectModel | undefined, exists: boolean): string {
  const path = displayPath(root, finding.path);
  if (finding.kind === "missing") return exists ? `${path} exists again.` : `${path} is no longer listed in CMake.`;
  if (!exists) return `${path} no longer exists.`;
  const owners = model ? ownersOf(model, finding.path).filter(target => target.isProjectTarget).map(target => target.name) : [];
  return owners.length > 0 ? `${path} is now built by ${owners.join(", ")}.` : `${path} is no longer reported as unregistered.`;
}

// ---------------------------------------------------------------------------
// Configure status

/** The CMake error part of configure output, capped, for pi to act on. */
export function configureErrorExcerpt(result: ConfigureResult): string {
  const [headline, ...rest] = result.output.split("\n");
  const first = rest.findIndex(line => /CMake Error/.test(line));
  // From the first error on; without one, the end of the output, where the failure usually is.
  let body = rest.slice(Math.max(first, 0)).join("\n");
  const shortened = body.length > ERROR_EXCERPT_CHARS;
  if (shortened) body = first >= 0 ? body.slice(0, ERROR_EXCERPT_CHARS) : body.slice(-ERROR_EXCERPT_CHARS);
  const note = shortened ? `\n[CMake output shortened${result.logFile ? `; full output: ${result.logFile}` : ""}]` : "";
  return `${headline}\n${body}`.trim() + note;
}

const failedStatus = (result: ConfigureResult | undefined) => result !== undefined && result.status !== "succeeded";

function configureSection(input: BriefingInput): string[] {
  const { result, model } = input;
  const lines: string[] = [];
  if (input.status === "configuring") lines.push("CMake is reconfiguring; changes follow in later updates.");
  if (failedStatus(result)) {
    lines.push("## Configure failed", "```", configureErrorExcerpt(result!), "```");
  } else if (input.modelError) {
    lines.push("## Configure succeeded, but its project model could not be read", input.modelError);
  }
  if (failedStatus(result) || input.modelError) {
    lines.push(model
      ? "Using the project model from the last successful configure; it may be stale until configure succeeds again."
      : "No project model is available until configure succeeds. Fix the error above; the extension reconfigures after CMake files change.");
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Targets

function ownedDirectories(root: string, target: ProjectTarget): string[] {
  const dirs = [...new Set(target.sources.filter(source => !source.isGenerated).map(source => displayPath(root, dirname(source.path))))].sort();
  return dirs.length > 0 ? dirs : [displayPath(root, target.sourceDir)];
}

function targetRow(root: string, target: ProjectTarget): string {
  const dirs = ownedDirectories(root, target);
  const shown = dirs.slice(0, MAX_LISTED_DIRS).join(", ") + (dirs.length > MAX_LISTED_DIRS ? ` +${dirs.length - MAX_LISTED_DIRS} more` : "");
  const deps = target.dependencies.length > 0 ? target.dependencies.join(", ") : "-";
  return `| ${target.name} | ${target.kind} | ${shown} | ${formatStandard(target.cxxStandard)} | ${deps} |`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function header(input: BriefingInput): string[] {
  const { model, result } = input;
  const lines = [`# C++ project briefing (CMake)`, `Source root: ${input.root}`];
  const preset = result?.preset ?? "none";
  const configuration = model?.configuration || "(none)";
  lines.push(`Preset: ${preset}. Configuration: ${configuration}.${result?.generator ? ` Generator: ${result.generator}.` : ""}${model?.cmakeVersion ? ` CMake ${model.cmakeVersion}.` : ""}`);
  const buildDir = result?.buildDir ?? model?.buildDir;
  if (buildDir) lines.push(`Managed build directory: ${buildDir}`);
  return lines;
}

const HINTS = [
  "## Working in this project",
  "- Build with cpp_build and run tests with cpp_test. Tests discovered at build time (such as gtest_discover_tests) appear in CTest only after a build.",
  "- When you add, move or delete a .c, .cc, .cpp or .cxx file, register the change in the owning target's CMakeLists.txt. The extension never edits build files; it reports unregistered and missing sources after each write, edit and shell command.",
  "- Write code that is valid for the C++ standard of the target that owns the file (Standard column).",
];

function notes(input: BriefingInput): string[] {
  return [...(input.result?.notes ?? []), ...(input.model?.notes ?? [])];
}

function full(input: BriefingInput): string {
  const { root, model } = input;
  const lines = header(input);
  lines.push(...configureSection(input));
  if (model) {
    const project = model.targets.filter(target => target.isProjectTarget);
    const external = model.targets.filter(target => !target.isProjectTarget);
    lines.push("## Targets", "| Target | Kind | Directories | Standard | Depends on |", "|---|---|---|---|---|", ...project.map(target => targetRow(root, target)));
    if (external.length > 0) lines.push(`Also ${plural(external.length, "target")} from outside the project: ${external.map(target => target.name).join(", ")}.`);
  }
  lines.push(...HINTS);
  if (input.findings.length > 0 || input.skipped) {
    lines.push(`## Drift (${input.findings.length} open)`, ...input.findings.map(finding => `- ${describeFinding(finding, root)}`));
    if (input.skipped) lines.push(`- Note: ${input.skipped}.`);
  }
  if (input.referenced.length > 0) {
    lines.push("## Referenced in CMake but not built in this configuration (informational)",
      ...input.referenced.map(source => `- ${displayPath(root, source.path)} (${at(root, source.file, source.line)})`));
  }
  const allNotes = notes(input);
  if (allNotes.length > 0) lines.push("## Notes", ...allNotes.map(note => `- ${note}`));
  return lines.join("\n");
}

function summary(input: BriefingInput, budget: number): string {
  const { model } = input;
  const lines = header(input);
  lines.push(...configureSection(input));
  const tail: string[] = [];
  const counts: string[] = [];
  if (input.findings.length > 0) {
    const missing = input.findings.filter(finding => finding.kind === "missing").length;
    counts.push(`${plural(input.findings.length, "drift finding")} open (${input.findings.length - missing} unregistered, ${missing} missing)`);
  }
  if (input.skipped) counts.push(input.skipped);
  if (input.referenced.length > 0) counts.push(`${plural(input.referenced.length, "source")} referenced in CMake but not built in this configuration`);
  const noteCount = notes(input).length;
  if (noteCount > 0) counts.push(plural(noteCount, "model note"));
  if (counts.length > 0) tail.push(`${counts.join("; ")}.`);
  tail.push("This project is too large to brief in full. Use cpp_project for each target's directories, standard, dependencies and sources, for the drift list and for the model notes.");
  tail.push(...HINTS);

  if (model) {
    const project = model.targets.filter(target => target.isProjectTarget);
    const kinds = new Map<string, number>();
    const standards = new Map<string, number>();
    for (const target of project) {
      kinds.set(target.kind, (kinds.get(target.kind) ?? 0) + 1);
      const standard = formatStandard(target.cxxStandard);
      standards.set(standard, (standards.get(standard) ?? 0) + 1);
    }
    lines.push(`## Targets`, `${plural(project.length, "target")}: ${[...kinds].map(([kind, count]) => `${count} ${kind}`).join(", ")}. Standards: ${[...standards].map(([standard, count]) => `${standard} (${count})`).join(", ")}.`);
    const fixed = [...lines, ...tail].join("\n").length + 2;
    const entries = project.map(target => `${target.name} (${target.kind})`);
    let listed = entries.join(", ");
    // Drop names from the end until the list fits the budget.
    for (let shown = entries.length - 1; fixed + listed.length > budget && shown > 0; shown--) {
      listed = `${entries.slice(0, shown).join(", ")}, and ${entries.length - shown} more`;
    }
    lines.push(listed);
  }
  return [...lines, ...tail].join("\n");
}

/** Render the session briefing (R6, R7): the full form within the budget, else a target-level summary. */
export function renderBriefing(input: BriefingInput, budget = BRIEFING_BUDGET): string {
  const text = full(input);
  return text.length <= budget ? text : summary(input, budget);
}
