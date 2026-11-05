import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { CppPlugin } from "./server.ts";

/** The Claude Code events whose hooks add context next to a prompt or a tool result. */
type HookEvent = "UserPromptSubmit" | "PostToolUse" | "SessionStart";

/**
 * Claude Code reads an mcp_tool hook's text result like a command hook's output, so the text is the
 * hook's JSON. Nothing to say is an empty text, which adds nothing.
 */
export function hookResult(event: HookEvent, context: string | undefined): CallToolResult {
  const text = context ? JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }) : "";
  return { content: [{ type: "text", text }] };
}

const FOR_HOOKS = "Called by the cpp-lsp plugin's hooks; not for direct use.";

export const HOOK_TOOLS: Tool[] = [
  {
    name: "cpp_hook_prompt",
    description: `${FOR_HOOKS} Returns the C++ project briefing, or what changed since the last prompt, as UserPromptSubmit hook output.`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "cpp_hook_post_edit",
    description: `${FOR_HOOKS} Formats a written or edited C/C++ file and returns the post-edit note (drift, owning targets and their standard, diagnostics) as PostToolUse hook output.`,
    inputSchema: { type: "object", properties: { file_path: { type: "string", description: "The file the Write or Edit tool wrote" } } },
  },
  {
    name: "cpp_hook_after_shell",
    description: `${FOR_HOOKS} Returns the CMake drift a shell command caused as PostToolUse hook output.`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "cpp_hook_session_start",
    description: `${FOR_HOOKS} Marks the briefing due again after the conversation was cleared, compacted or resumed.`,
    inputSchema: { type: "object", properties: { source: { type: "string", description: "Why the session started: clear, compact or resume" } } },
  },
];

/** The next prompt's context: the one-time notices, then the briefing or what changed. */
async function prompt(plugin: CppPlugin): Promise<string | undefined> {
  const session = plugin.current();
  // Waits for root discovery and the cmake probe, whose notices go out with this prompt.
  const message = await session.promptMessage();
  const parts = [...plugin.takeNotices(), ...(message ? [message.content] : [])];
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/**
 * The note after a Write or Edit. In a project the user has not enabled, the plugin stays inactive:
 * it does not format the user's files or start clangd there.
 */
async function postEdit(plugin: CppPlugin, file: unknown): Promise<string | undefined> {
  if (plugin.untrusted()) return undefined;
  const session = plugin.current();
  return typeof file === "string" && file ? session.postEditNote(file) : session.afterShell();
}

async function afterShell(plugin: CppPlugin): Promise<string | undefined> {
  if (plugin.untrusted()) return undefined;
  return plugin.current().afterShell();
}

/** Runs the hook tool `name`, or returns undefined when `name` is not one. */
export async function runHook(plugin: CppPlugin, name: string, args: Record<string, unknown>): Promise<CallToolResult | undefined> {
  switch (name) {
    case "cpp_hook_prompt":
      return hookResult("UserPromptSubmit", await prompt(plugin));
    case "cpp_hook_post_edit":
      return hookResult("PostToolUse", await postEdit(plugin, args.file_path));
    case "cpp_hook_after_shell":
      return hookResult("PostToolUse", await afterShell(plugin));
    case "cpp_hook_session_start":
      // Startup needs nothing: the first prompt carries the briefing. Every later start (clear,
      // compact, resume) leaves Claude without it, while this server keeps running.
      if (args.source !== "startup") plugin.conversationReset();
      return hookResult("SessionStart", undefined);
    default:
      return undefined;
  }
}
