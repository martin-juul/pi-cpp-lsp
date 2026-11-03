import assert from "node:assert/strict";
import test from "node:test";
import extension from "../extensions/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

test("extension registers the complete tool set, the project session lifecycle and report points", () => {
  const tools: string[] = [];
  const events: string[] = [];
  const commands: string[] = [];
  extension({
    registerTool(tool: { name: string }) { tools.push(tool.name); },
    on(event: string) { events.push(event); },
    registerCommand(name: string) { commands.push(name); },
  } as unknown as ExtensionAPI);
  assert.deepEqual(tools.sort(), [
    "cpp_build", "cpp_calls", "cpp_check", "cpp_compile", "cpp_definition", "cpp_format",
    "cpp_gen_compdb", "cpp_hover", "cpp_project", "cpp_references", "cpp_run", "cpp_symbols",
    "cpp_test", "cpp_types",
  ]);
  for (const event of ["session_start", "session_shutdown", "session_compact", "before_agent_start", "tool_result"]) {
    assert.ok(events.includes(event), event);
  }
  assert.ok(commands.includes("cpp-setup"));
  assert.ok(commands.includes("cpp-preset"));
});
