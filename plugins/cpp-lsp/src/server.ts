import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ClangdOptions } from "../../../packages/core/src/clangd.ts";
import type { PostEditOptions } from "../../../packages/core/src/diagnostics.ts";
import type { Exec } from "../../../packages/core/src/exec.ts";
import { projectLog } from "../../../packages/core/src/log.ts";
import { findSourceRoot } from "../../../packages/core/src/project/root.ts";
import { presetCommand } from "../../../packages/core/src/project/tools.ts";
import { CppSession } from "../../../packages/core/src/session.ts";
import type { ToolchainServiceOptions } from "../../../packages/core/src/toolchain.ts";
import { cppTools, defineTool, type CppTools, type ToolSpec } from "../../../packages/core/src/tools.ts";
import { HOOK_TOOLS, runHook } from "./hooks.ts";
import { errorMessage, isEntry, nodeExec, TRUST_COMMAND, UNTRUSTED, usePluginWording } from "./runtime.ts";
import { isTrusted } from "./trust.ts";

export const SERVER_NAME = "cpp-lsp";
export const SERVER_VERSION = "1.0.0";

/** How long the check for Claude Code's own clangd-lsp plugin may take. */
const CLAUDE_LIST_TIMEOUT_MS = 10_000;

export interface PluginOptions {
  /** The Claude Code project directory; the CMake root is searched from here. */
  projectDir: string;
  /** The plugin's data directory, which holds the list of enabled projects. */
  dataDir?: string;
  exec: Exec;
  /** Report-point wait bound. */
  waitMs?: number;
  /** Wait bounds for the post-edit diagnostics. */
  diagnostics?: Pick<PostEditOptions, "waitMs" | "firstOpenWaitMs">;
  /** How the feature probes start clangd, and their bound. */
  toolchain?: Pick<ToolchainServiceOptions, "clangd" | "clangdTimeoutMs">;
  /** How the managed clangd starts. */
  clangd?: ClangdOptions;
}

interface Notice {
  text: string;
  sent: boolean;
}

/**
 * One Claude Code session's C++ support: the core session for the project directory, rebuilt
 * whenever the user enables or disables the project, the tools on top of it, and the one-time
 * notices that reach Claude with the next prompt.
 */
export class CppPlugin {
  readonly projectDir: string;
  /** The CMake source root, or undefined outside a CMake project. */
  readonly root?: string;
  readonly tools: CppTools;
  /** Settles once the check for Claude Code's own clangd-lsp plugin has run. */
  readonly coexistence: Promise<void>;
  private readonly options: PluginOptions;
  private session: CppSession;
  private trusted: boolean;
  private notices: Notice[] = [];

  constructor(options: PluginOptions) {
    usePluginWording();
    this.options = options;
    this.projectDir = options.projectDir;
    this.root = findSourceRoot(options.projectDir);
    this.trusted = this.readTrust();
    this.session = this.build();
    this.tools = cppTools(() => this.session, { exec: options.exec, clangd: options.clangd, ...options.diagnostics });
    this.coexistence = this.checkClangdLsp();
  }

  /** Outside a CMake project there is nothing to enable, so the tools behave as in pi. */
  private readTrust(): boolean {
    return this.root === undefined || isTrusted(this.options.dataDir, this.root);
  }

  private build(): CppSession {
    const { projectDir, exec, waitMs, diagnostics, toolchain, clangd } = this.options;
    // The notices of the session this one replaces no longer hold.
    const notices: Notice[] = [];
    this.notices = notices;
    return new CppSession({
      cwd: projectDir, exec, waitMs, diagnostics, toolchain, clangd,
      trusted: this.trusted,
      untrusted: UNTRUSTED,
      notify: text => { notices.push({ text, sent: false }); },
    });
  }

  /**
   * The session for this call. The trust list is read on every call, so `/cpp-lsp:trust` takes
   * effect in the running session; the new session's first prompt carries the briefing.
   */
  current(): CppSession {
    const trusted = this.readTrust();
    if (trusted !== this.trusted) {
      this.trusted = trusted;
      void this.session.dispose();
      this.session = this.build();
    }
    return this.session;
  }

  /** The current session, or undefined in a CMake project the user has not enabled. */
  activeSession(): CppSession | undefined {
    const session = this.current();
    return this.trusted ? session : undefined;
  }

  /** The tools' answer in a project the user has not enabled: the tools would run its code. */
  gateMessage(): string {
    return `${this.root} is a CMake project, but the cpp-lsp plugin is not enabled for it, and its C++ tools would run the project's CMake code or compiler. Nothing ran. Ask the user to enable it with ${TRUST_COMMAND}.`;
  }

  /** The one-time notices not yet sent; each goes out once, until a new conversation re-arms it. */
  takeNotices(): string[] {
    const pending = this.notices.filter(notice => !notice.sent);
    for (const notice of pending) notice.sent = true;
    return pending.map(notice => notice.text);
  }

  /** The conversation was cleared, compacted or resumed: it lost the briefing and the notices. */
  conversationReset(): void {
    const session = this.current();
    session.compacted();
    for (const notice of this.notices) notice.sent = false;
  }

  /** The guidance for the whole session, sent once in the MCP handshake. */
  async instructions(): Promise<string> {
    const guidelines = await this.current().guidelines();
    const names = this.tools.specs.map(spec => spec.name).join(", ");
    return [
      ...guidelines,
      `C/C++ tools from the cpp-lsp plugin: ${names}. Use cpp_references, cpp_symbols, cpp_calls and cpp_types instead of grep to find C/C++ code, and cpp_project for the CMake targets and the C++ standard each uses.`,
    ].join("\n");
  }

  /**
   * Claude Code's official clangd-lsp plugin shows clangd's diagnostics to Claude on its own, past
   * the build compiler's check. That is worth one log line, never a note in results; any failure to
   * ask Claude Code skips the check.
   */
  private async checkClangdLsp(): Promise<void> {
    const root = this.root;
    if (!root) return;
    try {
      const result = await this.options.exec("claude", ["plugin", "list", "--json"], { cwd: this.projectDir, timeout: CLAUDE_LIST_TIMEOUT_MS });
      if (result.code !== 0 || result.killed) return;
      const plugins: unknown = JSON.parse(result.stdout);
      const enabled = Array.isArray(plugins) && plugins.some(entry =>
        typeof entry?.id === "string" && entry.id.startsWith("clangd-lsp@") && entry.enabled === true);
      if (enabled) {
        projectLog(root)("Claude Code's clangd-lsp plugin is enabled as well: its clangd diagnostics reach Claude directly, without the build compiler's check cpp-lsp runs where clangd lacks a target's C++ features.");
      }
    } catch { /* no usable answer from Claude Code */ }
  }

  async dispose(): Promise<void> {
    await this.tools.close();
    await this.session.dispose();
  }
}

/** The preset command, as a tool: Claude calls it for the user's `/cpp-lsp:cpp-preset`. */
function presetToolSpec(plugin: CppPlugin): ToolSpec {
  return defineTool({
    name: "cpp_preset",
    label: "C++ Preset",
    description:
      "List the CMake configure presets of the project, or switch the project to one and reconfigure. Switch presets only when the user asked for it, as with /cpp-lsp:cpp-preset <name>.",
    promptSnippet: "List or switch the CMake configure presets for the user's /cpp-lsp:cpp-preset command",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "The preset to switch to and reconfigure with; leave it out to list the presets" })),
    }),
    async execute(params) {
      const messages: string[] = [];
      let failed = false;
      await presetCommand(plugin.current().project, params.name ?? "", plugin.projectDir, (message, level) => {
        messages.push(message);
        failed ||= level === "error";
      });
      return { content: [{ type: "text", text: messages.join("\n") }], details: undefined, isError: failed };
    },
  });
}

/** pi shows a tool's snippet and guidelines in its system prompt; Claude Code reads them from the description. */
function describe(spec: ToolSpec): string {
  const snippet = /[.!?]$/.test(spec.promptSnippet) ? spec.promptSnippet : `${spec.promptSnippet}.`;
  return [spec.description, "", snippet, ...(spec.promptGuidelines ?? [])].join("\n");
}

const text = (value: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: value }], ...(isError ? { isError } : {}) });

/** Validates and converts the arguments as pi does before a tool runs. */
function checkArguments(spec: ToolSpec, args: unknown): { params: unknown } | { error: string } {
  const params = Value.Convert(spec.parameters, structuredClone(args ?? {}));
  if (Value.Check(spec.parameters, params)) return { params };
  const errors = [...Value.Errors(spec.parameters, params)].map(error => `  - ${error.instancePath || "root"}: ${error.message}`);
  return { error: `Invalid arguments for ${spec.name}:\n${errors.join("\n")}` };
}

/** The MCP server for one plugin session: every cpp_* tool, cpp_preset and the hook tools. */
export async function createServer(plugin: CppPlugin): Promise<Server> {
  const specs = [...plugin.tools.specs, presetToolSpec(plugin)];
  const byName = new Map(specs.map(spec => [spec.name, spec]));
  const tools: Tool[] = [
    // Plain JSON: TypeBox's symbol keys and undefined fields drop out.
    ...specs.map(spec => ({ name: spec.name, description: describe(spec), inputSchema: JSON.parse(JSON.stringify(spec.parameters)) })),
    ...HOOK_TOOLS,
  ];

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: await plugin.instructions() },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const hook = await runHook(plugin, name, args ?? {});
    if (hook) return hook;
    const spec = byName.get(name);
    if (!spec) return text(`Unknown tool: ${name}`, true);
    // In a CMake project the user has not enabled, no tool runs anything.
    if (!plugin.activeSession()) return text(plugin.gateMessage(), true);
    const checked = checkArguments(spec, args);
    if ("error" in checked) return text(checked.error, true);
    try {
      const result = await spec.execute(checked.params as never, { cwd: plugin.projectDir, signal: extra.signal });
      return { content: result.content, ...(result.isError ? { isError: true } : {}) };
    } catch (error) {
      return text(`${name} failed: ${errorMessage(error)}`, true);
    }
  });
  return server;
}

async function main(): Promise<void> {
  // The docs leave a plugin server's working directory open; Claude Code names the project instead.
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const plugin = new CppPlugin({ projectDir, dataDir: process.env.CLAUDE_PLUGIN_DATA, exec: nodeExec });
  const server = await createServer(plugin);
  let closing = false;
  // The session ends when Claude Code closes the server's stdin or stops it.
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await Promise.race([plugin.dispose(), new Promise(done => setTimeout(done, 5000).unref())]);
    process.exit(0);
  };
  server.onclose = () => void shutdown();
  process.stdin.on("end", () => void shutdown());
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, () => void shutdown());
  await server.connect(new StdioServerTransport());
}

if (isEntry(import.meta.url)) void main();
