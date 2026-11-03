import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_OUTPUT_BYTES = 40_000;
const MAX_OUTPUT_LINES = 1_000;

// Keep model-visible output bounded while preserving diagnostics for inspection.
export function boundedOutput(output: string): { text: string; truncated: boolean; logFile?: string } {
  const lines = output.split("\n");
  const firstLines = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
  const bytes = Buffer.from(firstLines);
  const truncated = lines.length > MAX_OUTPUT_LINES || bytes.length > MAX_OUTPUT_BYTES;
  if (!truncated) return { text: output, truncated: false };
  let end = Math.min(bytes.length, MAX_OUTPUT_BYTES);
  // A byte cap must not split a UTF-8 character.
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  const logFile = join(mkdtempSync(join(tmpdir(), "pi-cpp-")), "output.log");
  writeFileSync(logFile, output, "utf8");
  return {
    text: `${bytes.subarray(0, end).toString("utf8")}\n\n[Output truncated. Full output saved to: ${logFile}]`,
    truncated: true,
    logFile,
  };
}
