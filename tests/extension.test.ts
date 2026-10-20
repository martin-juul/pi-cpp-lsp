import assert from "node:assert/strict";
import test from "node:test";
import extension from "../extensions/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

test("extension registers the complete tool set and shutdown lifecycle", () => {
  const tools: string[] = [];
  const events: string[] = [];
  const commands: string[] = [];
  extension({
    registerTool(tool: { name: string }) { tools.push(tool.name); },
    on(event: string) { events.push(event); },
    registerCommand(name: string) { commands.push(name); },
  } as unknown as ExtensionAPI);
  assert.deepEqual(tools.sort(), [
    "cpp_build", "cpp_check", "cpp_compile", "cpp_definition", "cpp_format",
    "cpp_gen_compdb", "cpp_hover", "cpp_test",
  ]);
  assert.ok(events.includes("session_shutdown"));
  assert.ok(events.includes("tool_result"));
  assert.ok(commands.includes("cpp-setup"));
});
