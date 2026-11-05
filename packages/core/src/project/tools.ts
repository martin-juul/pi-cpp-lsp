import { resolve } from "node:path";
import { Type } from "typebox";
import { boundedOutput } from "../output.ts";
import { configureErrorExcerpt, displayPath, ownedDirectories } from "./briefing.ts";
import { findTarget, formatStandard, type ProjectModel, type ProjectTarget } from "./model.ts";
import { writeRememberedPreset } from "./root.ts";
import type { PresetChoice, ProjectService } from "./session.ts";
import { defineTool, type ToolSpec } from "../tools.ts";
import { harness } from "../harness.ts";

const ACTIONS = ["overview", "targets", "target", "owner", "refresh", "presets"] as const;
type Action = typeof ACTIONS[number];

interface Parameters {
  action: Action;
  name?: string;
  path?: string;
}

interface Details {
  action: Action;
  status: string;
  truncated: boolean;
  logFile?: string;
}

const list = (items: readonly string[]) => items.length > 0 ? items.join(", ") : "-";
const projectTargets = (model: ProjectModel) => model.targets.filter(target => target.isProjectTarget);

/** Why the session has no project model to query, or undefined when it has project support. */
function unsupported(project: ProjectService | undefined, cwd: string): string | undefined {
  if (!project?.root) return `${cwd} is not a CMake project: no CMakeLists.txt was found in it or its parent directories.`;
  if (!project.isCmake) {
    const hint = project.disabledHint ? ` ${project.disabledHint}` : "";
    return `${project.root} is a CMake project, but ${project.disabledReason ?? "CMake is unavailable"}, so the project model is unavailable.${hint}`;
  }
  return undefined;
}

function loading(project: ProjectService): string {
  const last = project.lastConfigure;
  const state = last ? ` The last finished configure ${last.status === "succeeded" ? "succeeded" : "did not succeed"}; its model may be outdated.` : "";
  return `The CMake project model for ${project.root} is still loading (configure is running).${state} Call cpp_project again shortly.`;
}

/** A note when answers come from the last good model after a failed configure (KTD22). */
function staleNote(project: ProjectService): string[] {
  return project.status === "failed" ? ["Note: the last CMake configure failed; this answer uses the model from the last successful configure and may be stale. Use cpp_project overview for the error.", ""] : [];
}

function noModel(project: ProjectService): string {
  const result = project.lastConfigure;
  const error = result && result.status !== "succeeded" ? `\n${configureErrorExcerpt(result)}` : "";
  return `No CMake project model is available for ${project.root}; the configure failed or its replies could not be read.${error}`;
}

function targetLine(root: string, target: ProjectTarget): string {
  return `- ${target.name} (${target.kind}, ${formatStandard(target.cxxStandard)}) in ${list(ownedDirectories(root, target))}; depends on: ${list(target.dependencies)}`;
}

function targetsText(project: ProjectService, model: ProjectModel): string {
  const root = project.root!;
  const own = projectTargets(model);
  const external = model.targets.filter(target => !target.isProjectTarget);
  const preset = project.lastConfigure?.preset ?? "none";
  const lines = [`${own.length} project targets (preset ${preset}, configuration ${model.configuration || "(none)"}):`, ...own.map(target => targetLine(root, target))];
  if (external.length > 0) lines.push(`Targets from outside the project: ${external.map(target => target.name).join(", ")}.`);
  return lines.join("\n");
}

function targetText(root: string, target: ProjectTarget): string {
  const show = (path: string) => displayPath(root, path);
  const lines = [
    `Target ${target.name} (${target.kind}, CMake type ${target.type})`,
    `Defined in: ${show(target.sourceDir)}/CMakeLists.txt`,
    `Standard: ${formatStandard(target.cxxStandard)}`,
    `Depends on: ${list(target.dependencies)}`,
  ];
  if (target.artifacts.length > 0) lines.push(`Artifacts: ${target.artifacts.join(", ")}`);
  lines.push(`Include directories (${target.includeDirs.length}):`, ...target.includeDirs.map(dir => `- ${show(dir)}`));
  lines.push(`Defines (${target.defines.length}):`, ...target.defines.map(define => `- ${define}`));
  lines.push(`Sources (${target.sources.length}):`, ...target.sources.map(source => {
    const marks = [
      ...(source.isGenerated ? ["generated"] : []),
      ...(source.language === "CXX" && source.standard !== target.cxxStandard ? [formatStandard(source.standard)] : []),
    ];
    return `- ${show(source.path)}${marks.length > 0 ? ` (${marks.join(", ")})` : ""}`;
  }));
  return lines.join("\n");
}

function ownerText(project: ProjectService, model: ProjectModel, path: string): string {
  const shown = displayPath(project.root!, path);
  const owner = project.ownerOf(path);
  if (!owner) return `No project target builds ${shown} in this configuration.`;
  const owners = owner.targets.map(name => `${name} (${formatStandard(findTarget(model, name)?.cxxStandard)})`);
  return [
    `${shown} is built by: ${owners.join(", ")}`,
    `Must stay valid for: ${owner.standardText}${owner.targets.length > 1 ? " (the most restrictive standard among its owners)" : ""}`,
  ].join("\n");
}

/** The preset listing shared by `/cpp-preset` and `cpp_project presets`, headed by `heading`; `switchLine` follows the presets. */
function presetListing(root: string, choice: PresetChoice, heading: string, switchLine: string): string[] {
  if (choice.available.length === 0) return [`${root} has no usable configure presets.`, ...choice.notes];
  const lines = choice.available.map(preset => {
    const marks = [...(preset === choice.active ? ["active"] : []), ...(preset === choice.defaultPreset ? ["default"] : [])];
    return `  ${preset}${marks.length > 0 ? ` (${marks.join(", ")})` : ""}`;
  });
  return [`${heading} ${root}:`, ...lines, switchLine, ...choice.notes];
}

/** Settles with the promise, or with false once the signal aborts. */
async function untilAborted(promise: Promise<unknown>, signal: AbortSignal | undefined): Promise<boolean> {
  if (!signal) return promise.then(() => true);
  if (signal.aborted) return false;
  let onAbort = () => {};
  const aborted = new Promise<false>(resolve => { onAbort = () => resolve(false); signal.addEventListener("abort", onAbort, { once: true }); });
  try {
    return await Promise.race([promise.then(() => true as const), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * `cpp_project`: overview, targets, target, owner, refresh, plus a read-only presets listing.
 * `getProject` returns the session's ProjectService, or undefined before or outside one.
 */
export function projectToolSpec(getProject: () => ProjectService | undefined): ToolSpec {
  async function answer(params: Parameters, signal: AbortSignal | undefined, cwd: string): Promise<{ text: string; isError: boolean; status: string }> {
    const project = getProject();
    await project?.ready();
    const reason = unsupported(project, cwd);
    if (reason || !project) return { text: reason!, isError: true, status: "non-cmake" };
    const root = project.root!;
    // Listing presets needs no model, so it answers while configuring too.
    if (params.action === "presets") {
      const choice = await project.presets();
      if (!choice) return { text: `The configure presets for ${root} are unavailable.`, isError: true, status: project.status };
      const lines = presetListing(root, choice, "Configure presets for", `Only the user can switch presets, with the ${harness.presetCommand} <name> command; cpp_project only lists them.`);
      return { text: lines.join("\n"), isError: false, status: project.status };
    }
    if (project.status === "configuring") return { text: loading(project), isError: false, status: "configuring" };

    if (params.action === "overview") return { text: project.briefing(Infinity), isError: false, status: project.status };

    if (params.action === "refresh") {
      if (!(await untilAborted(project.reconfigureNow(), signal))) {
        return { text: "Refresh cancelled; the CMake configure continues in the background.", isError: true, status: project.status };
      }
      const result = project.lastConfigure;
      const model = project.model;
      const head = project.status === "ready"
        ? `CMake configure succeeded${result?.preset ? ` with preset ${result.preset}` : ""}.`
        : result && result.status !== "succeeded" ? configureErrorExcerpt(result) : "CMake configure succeeded, but its project model could not be read.";
      const body = model ? ["", ...(project.status === "failed" ? ["Targets from the last successful configure:"] : []), targetsText(project, model)] : [];
      return { text: [head, ...body].join("\n"), isError: project.status !== "ready", status: project.status };
    }

    const model = project.model;
    if (!model) return { text: noModel(project), isError: true, status: project.status };
    const note = staleNote(project);
    const reply = (text: string, isError = false) => ({ text: [...note, text].join("\n"), isError, status: project.status });

    if (params.action === "targets") return reply(targetsText(project, model));
    if (params.action === "target") {
      const names = projectTargets(model).map(target => target.name).sort();
      const target = params.name ? findTarget(model, params.name) : undefined;
      if (!target) {
        const what = params.name ? `No target named "${params.name}".` : "The target action needs a name.";
        return reply(`${what} Valid project targets: ${list(names)}.`, true);
      }
      return reply(targetText(root, target));
    }
    if (!params.path) return reply("The owner action needs a path.", true);
    return reply(ownerText(project, model, resolve(cwd, params.path)));
  }

  return defineTool({
    name: "cpp_project",
    label: "C++ Project",
    description:
      "Query the CMake project model the extension configures. Actions: overview (the full project briefing: targets, standards, drift, notes), " +
      "targets (list targets), target (one target's sources, include directories, defines, standard and dependencies; needs name), " +
      "owner (the targets that build a file and the C++ standard it must stay valid for; needs path), refresh (reconfigure now and return the result), " +
      `presets (list the configure presets, the active one and the default; read-only, the user switches presets with ${harness.presetCommand}).`,
    promptSnippet: "Query the CMake project: targets, a target's sources/flags/standard, a file's owning targets, configure presets, or force a reconfigure",
    parameters: Type.Object({
      action: Type.Enum([...ACTIONS], { description: "overview | targets | target | owner | refresh | presets" }),
      name: Type.Optional(Type.String({ minLength: 1, description: "Target name, for action target" })),
      path: Type.Optional(Type.String({ minLength: 1, description: "File path, absolute or relative to the working directory, for action owner" })),
    }),
    async execute(params, { cwd, signal }) {
      const { text, isError, status } = await answer(params as Parameters, signal, cwd);
      const bounded = boundedOutput(text);
      const details: Details = { action: (params as Parameters).action, status, truncated: bounded.truncated, logFile: bounded.logFile };
      return { content: [{ type: "text" as const, text: bounded.text }], details, isError };
    },
  });
}

export type Notify = (message: string, level: "info" | "warning" | "error") => void;

/**
 * The /cpp-preset command: with no name it lists the configure presets; with a name it
 * remembers that preset, reconfigures and tells the user how the configure went.
 */
export async function presetCommand(project: ProjectService | undefined, args: string, cwd: string, notify: Notify): Promise<void> {
  await project?.ready();
  const reason = unsupported(project, cwd);
  if (reason || !project) {
    notify(`${harness.notePrefix} ${reason}`, "warning");
    return;
  }
  const choice = await project.presets();
  if (!choice) return;
  const root = project.root!;
  const name = args.trim();
  if (choice.available.length === 0 || !name) {
    notify(`${harness.notePrefix} ${presetListing(root, choice, "configure presets for", `Switch with ${harness.presetCommand} <name>.`).join("\n")}`, name ? "warning" : "info");
    return;
  }
  if (!choice.available.includes(name)) {
    notify(`${harness.notePrefix} no configure preset named "${name}"; nothing changed. Available presets: ${choice.available.join(", ")}.`, "warning");
    return;
  }
  writeRememberedPreset(root, name);
  notify(`${harness.notePrefix} using preset ${name} for ${root}; reconfiguring.`, "info");
  await project.reconfigureNow();
  // The next run carries the full briefing, which names the new preset.
  project.resendBriefing();
  const result = project.lastConfigure;
  if (project.status === "ready") notify(`${harness.notePrefix} CMake configure with preset ${name} succeeded.`, "info");
  else notify(`${harness.notePrefix} CMake configure with preset ${name} did not succeed.${result && result.status !== "succeeded" ? `\n${configureErrorExcerpt(result)}` : ""}`, "error");
}
