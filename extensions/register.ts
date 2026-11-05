import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProjectService } from "../packages/core/src/project/session.ts";
import { presetCommand } from "../packages/core/src/project/tools.ts";
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
