import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildToolSpecs, type ProjectModelSource } from "../packages/core/src/build.ts";
import { clangdToolSpecs, ManagedClangd, type ClangdOptions, type ManagedProject } from "../packages/core/src/clangd.ts";
import { navigationToolSpecs } from "../packages/core/src/navigation.ts";
import type { ProjectService } from "../packages/core/src/project/session.ts";
import { presetCommand, projectToolSpec } from "../packages/core/src/project/tools.ts";
import { renameToolSpec, type RenameToolOptions as RenameSpecOptions } from "../packages/core/src/rename.ts";
import type { ToolchainService } from "../packages/core/src/toolchain.ts";
import type { ToolSpec } from "../packages/core/src/tools.ts";

/** Registers a core tool spec with pi; the schema and the result pass through unchanged. */
export function registerSpec(pi: ExtensionAPI, spec: ToolSpec): void {
  const { execute, ...definition } = spec;
  pi.registerTool({
    ...definition,
    execute: (_id, params, signal, onUpdate, ctx) => execute(params, { cwd: ctx.cwd, signal, onUpdate }),
  });
}

/** Registers /cpp-preset for the session's project service. */
export function registerPresetCommand(pi: ExtensionAPI, getProject: () => ProjectService | undefined): void {
  pi.registerCommand("cpp-preset", {
    description: "List the CMake configure presets, or switch to one and reconfigure: /cpp-preset [name]",
    handler: (args, ctx) => presetCommand(getProject(), args, ctx.cwd, (message, level) => ctx.ui.notify(message, level)),
  });
}

// The per-module registrations below wire one module's tools onto pi on their own, with the
// signatures the module tests drive. The extension itself registers the full list from cppTools.

export function registerBuildTools(pi: ExtensionAPI, project: ProjectModelSource = () => undefined): void {
  for (const spec of buildToolSpecs((command, args, options) => pi.exec(command, args, options), project)) registerSpec(pi, spec);
}

export function registerProjectTools(pi: ExtensionAPI, getProject: () => ProjectService | undefined): void {
  registerSpec(pi, projectToolSpec(getProject));
  registerPresetCommand(pi, getProject);
}

export interface ClangdToolOptions extends ClangdOptions {
  /** The session's project service; with a ready model, calls without `build_dir` use the managed connection. */
  getProject?: () => ManagedProject | undefined;
}

/**
 * Registers cpp_hover and cpp_definition and returns the managed connection for other tools. It
 * follows `getProject` at session start, at agent start and on each call.
 */
export function registerClangdTools(pi: ExtensionAPI, toolOptions: ClangdToolOptions = {}): ManagedClangd {
  const { getProject, ...options } = toolOptions;
  const managed = new ManagedClangd(options);
  const follow = () => { if (getProject) managed.attach(getProject()); };
  const tools = clangdToolSpecs(() => { follow(); return managed; }, options);
  pi.on("session_start", async () => { follow(); });
  pi.on("agent_start", async () => { follow(); });
  pi.on("session_shutdown", async () => {
    await tools.close();
    await managed.close();
  });
  for (const spec of tools.specs) registerSpec(pi, spec);
  return managed;
}

export function registerNavigationTools(pi: ExtensionAPI, managed: Pick<ManagedClangd, "connection">): void {
  for (const spec of navigationToolSpecs(() => managed)) registerSpec(pi, spec);
}

export interface RenameToolOptions extends Omit<RenameSpecOptions, "toolchain"> {
  /** The C++ feature profiles; see the core option of the same name. */
  toolchain?: Pick<ToolchainService, "gapProfiles" | "gapProfileFor">;
}

export function registerRenameTool(pi: ExtensionAPI, managed: Pick<ManagedClangd, "connection">, options: RenameToolOptions): void {
  const { toolchain, ...rest } = options;
  registerSpec(pi, renameToolSpec(() => managed, { ...rest, toolchain: () => toolchain }));
}
