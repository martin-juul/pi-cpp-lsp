import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PostEditOptions } from "../packages/core/src/diagnostics.ts";
import type { Exec } from "../packages/core/src/exec.ts";
import type { ProjectServiceOptions, UntrustedWording } from "../packages/core/src/project/session.ts";
import { CppSession, FIXED_GUIDELINES } from "../packages/core/src/session.ts";
import { setupLines } from "../packages/core/src/setup.ts";
import type { ToolchainServiceOptions } from "../packages/core/src/toolchain.ts";
import { cppTools } from "../packages/core/src/tools.ts";
import { registerPresetCommand, registerSpec } from "./register.ts";

/** pi's project trust, and how a user grants it. */
const UNTRUSTED: UntrustedWording = {
  reason: "pi does not trust this project, and configuring it would run the project's CMake code",
  steps: "trust the project with /trust and restart pi, or start pi with --approve",
};

export interface ExtensionOptions {
  /** Overrides for the per-session project service, such as a shorter report-point wait. */
  project?: Pick<ProjectServiceOptions, "waitMs">;
  /** Overrides for the post-edit diagnostics wait bounds. */
  diagnostics?: Pick<PostEditOptions, "waitMs" | "firstOpenWaitMs">;
  /** How the feature probes start clangd, and their bound. */
  toolchain?: Pick<ToolchainServiceOptions, "clangd" | "clangdTimeoutMs">;
}

export default function (pi: ExtensionAPI, options: ExtensionOptions = {}) {
  const exec: Exec = (command, args, execOptions) => pi.exec(command, args, execOptions);
  let session: CppSession | undefined;

  // The tools read the current session on every call; before one starts they keep their non-CMake behavior.
  const tools = cppTools(() => session, { exec, ...options.diagnostics });
  for (const spec of tools.specs) registerSpec(pi, spec);
  registerPresetCommand(pi, () => session?.project);

  pi.on("session_start", async (_event, ctx) => {
    void session?.dispose();
    // Root discovery and configure run in the background.
    session = new CppSession({
      cwd: ctx.cwd,
      exec,
      notify: (message, level) => ctx.ui.notify(message, level),
      waitMs: options.project?.waitMs,
      trusted: ctx.isProjectTrusted(),
      untrusted: UNTRUSTED,
      diagnostics: options.diagnostics,
      toolchain: options.toolchain,
    });
  });

  pi.on("session_shutdown", async () => {
    const current = session;
    session = undefined;
    await tools.close();
    await current?.dispose();
  });

  pi.on("session_compact", async () => {
    session?.compacted();
  });

  // ── Context injection ────────────────────────────────────────────
  pi.on("before_agent_start", async (event, _ctx) => {
    const current = session;
    const guidelines = current ? await current.guidelines() : FIXED_GUIDELINES;
    event.systemPromptOptions.promptGuidelines = [
      ...(event.systemPromptOptions.promptGuidelines ?? []),
      ...guidelines,
    ];
    if (!current?.project.isCmake) return;
    // Runs the extension itself started carry no new project information.
    if (event.messageType === "custom" && event.message.customType.startsWith("cpp-")) return;
    const message = await current.promptMessage();
    return message ? { message } : undefined;
  });

  // ── Post-edit pipeline on write/edit, project report point on bash ─
  pi.on("tool_result", async event => {
    let note: string | undefined;
    if (
      (event.toolName === "write" || event.toolName === "edit") &&
      !event.isError
    ) {
      const input = event.input as { path?: string };
      // Format, drift, owner and clangd diagnostics in one note.
      note = input.path ? await session?.postEditNote(input.path) : await session?.afterShell();
    } else if (event.toolName === "bash") {
      note = await session?.afterShell();
    }
    if (note) {
      return { content: [...event.content, { type: "text" as const, text: `\n${note}` }] };
    }
  });

  pi.registerCommand("cpp-setup", {
    description: "Check the C/C++ toolchain (clangd, clang-format, clang-tidy, cppcheck, cmake, ninja) and which features it supports",
    handler: async (_args, ctx) => {
      ctx.ui.notify((await setupLines(exec, options.toolchain)).join("\n"), "info");
    },
  });
}
