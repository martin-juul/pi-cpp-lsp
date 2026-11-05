import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_OUTPUT_BYTES = 40_000;
const MAX_OUTPUT_LINES = 1_000;

/** `text` with its line breaks, and the whitespace around them, collapsed to single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ");
}

/** "1 file", "2 files". */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

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

/** Line and byte limits of head truncation, the same as pi's own tool output limits. */
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export interface HeadTruncation {
  /** The kept lines, whole lines only. */
  content: string;
  truncated: boolean;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
}

/** "512B", "1.5KB", "2.0MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * The first whole lines of `content` within both limits, counted as pi counts them: a trailing
 * newline ends the last line rather than starting another, and a first line over the byte limit
 * keeps nothing.
 */
export function truncateHead(content: string, maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES): HeadTruncation {
  const totalBytes = Buffer.byteLength(content, "utf8");
  const lines = content.length === 0 ? [] : content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  const totalLines = lines.length;
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return { content, truncated: false, totalLines, totalBytes, outputLines: totalLines, outputBytes: totalBytes };
  }
  const kept: string[] = [];
  let bytes = 0;
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const lineBytes = Buffer.byteLength(lines[i]!, "utf8") + (i > 0 ? 1 : 0);
    if (bytes + lineBytes > maxBytes) break;
    kept.push(lines[i]!);
    bytes += lineBytes;
  }
  const output = kept.join("\n");
  return { content: output, truncated: true, totalLines, totalBytes, outputLines: kept.length, outputBytes: Buffer.byteLength(output, "utf8") };
}

/** `output` within the head limits; past them the full text goes to a temporary file the result names. */
export function truncateOutput(output: string): string {
  const truncation = truncateHead(output);
  let result = truncation.content;
  if (truncation.truncated) {
    const tempFile = join(mkdtempSync(join(tmpdir(), "cpp-lsp-")), "output.txt");
    writeFileSync(tempFile, output, "utf8");
    result += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${tempFile}]`;
  }
  return result;
}
