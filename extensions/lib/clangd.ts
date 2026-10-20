import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_MESSAGE = 16 * 1024 * 1024;
const MAX_OUTPUT = 24_000;
type Message = { id?: number | string; method?: string; params?: any; result?: any; error?: { message: string; code?: number } };
type Pending = { resolve(value: any): void; reject(error: Error): void; cleanup(): void };
export interface ClangdOptions { command?: string; args?: string[]; timeoutMs?: number }

function aborted(): Error { return new Error("clangd request cancelled"); }
function checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw aborted(); }
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

/** A small stdio LSP client. Positions on the wire are zero-based UTF-16. */
export class ClangdConnection {
  private child: ChildProcessWithoutNullStreams;
  private buffer: Buffer = Buffer.alloc(0);
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private stderr = "";
  private documents = new Map<string, { text: string; version: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private dead = false;
  private closing = false;
  get alive() { return !this.dead && !this.closing; }

  readonly cwd: string;
  readonly buildDir?: string;
  private options: ClangdOptions;

  constructor(cwd: string, buildDir?: string, options: ClangdOptions = {}) {
    this.cwd = cwd;
    this.buildDir = buildDir;
    this.options = options;
    this.child = spawn(options.command ?? "clangd", [
      ...(options.args ?? []), "--background-index=false", "--log=error",
      ...(buildDir ? [`--compile-commands-dir=${buildDir}`] : []),
    ], { cwd, stdio: "pipe" });
    this.child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString()).slice(-4000); });
    this.child.on("error", (error) => this.fail(new Error(`Could not start clangd: ${error.message}. Install clangd and ensure it is on PATH.`)));
    this.child.on("exit", (code, signal) => this.fail(new Error(`clangd exited (${signal ?? code}). ${this.stderr}`)));
    this.child.stdin.on("error", (error) => this.fail(new Error(`clangd stdin failed: ${error.message}`)));
    this.child.stdout.on("end", () => this.fail(new Error(`clangd closed its output. ${this.stderr}`)));
    this.ready = this.initialize();
    // Initialization may fail before the first query is attached.
    void this.ready.catch(() => {});
  }

  private async initialize() {
    const result = await this.request("initialize", {
      processId: process.pid, rootUri: pathToFileURL(this.cwd).href,
      workspaceFolders: [{ uri: pathToFileURL(this.cwd).href, name: this.cwd }],
      capabilities: { general: { positionEncodings: ["utf-16"] }, offsetEncoding: ["utf-16"], textDocument: { hover: { contentFormat: ["markdown", "plaintext"] } } },
    });
    if ((result?.capabilities?.positionEncoding ?? result?.offsetEncoding ?? "utf-16") !== "utf-16") {
      this.fail(new Error("clangd selected an unsupported position encoding (expected UTF-16)"));
      throw new Error("clangd selected an unsupported position encoding");
    }
    this.send({ method: "initialized", params: {} });
  }

  private send(message: Message) {
    if (this.dead) throw new Error("clangd connection is closed");
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  private receive(chunk: Buffer) {
    if (this.dead) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      for (;;) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
          if (this.buffer.length > 8192) throw new Error("LSP header too large");
          return;
        }
        const match = /(?:^|\r\n)Content-Length:\s*(\d+)\s*(?:\r\n|$)/i.exec(this.buffer.subarray(0, headerEnd).toString("ascii"));
        if (!match) throw new Error("missing Content-Length");
        const length = Number(match[1]);
        if (length > MAX_MESSAGE) throw new Error("LSP message too large");
        if (this.buffer.length < headerEnd + 4 + length) return;
        const message: Message = JSON.parse(this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8"));
        this.buffer = this.buffer.subarray(headerEnd + 4 + length);
        if (message.method) {
          if (message.id !== undefined) {
            if (message.method === "workspace/configuration") this.send({ id: message.id, result: (message.params?.items ?? []).map(() => null) });
            else if (message.method === "workspace/workspaceFolders") this.send({ id: message.id, result: [{ uri: pathToFileURL(this.cwd).href, name: this.cwd }] });
            else this.send({ id: message.id, error: { code: -32601, message: `Unsupported client method: ${message.method}` } });
          }
          continue;
        }
        const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
        if (pending) {
          this.pending.delete(message.id as number);
          pending.cleanup();
          if (message.error) pending.reject(new Error(`clangd: ${message.error.message} (${message.error.code})`));
          else pending.resolve(message.result);
        }
      }
    } catch (error) { this.fail(new Error(`Invalid clangd protocol: ${(error as Error).message}`)); }
  }

  private request(method: string, params: unknown, signal?: AbortSignal): Promise<any> {
    checkSignal(signal);
    if (this.dead) return Promise.reject(new Error("clangd connection is closed"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.pending.delete(id);
        cleanup();
        try { this.send({ method: "$/cancelRequest", params: { id } }); } catch { /* already closed */ }
        reject(aborted());
      };
      const timer = setTimeout(() => this.fail(new Error(`clangd ${method} timed out after ${this.options.timeoutMs ?? 30_000}ms`)), this.options.timeoutMs ?? 30_000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", cancel, { once: true });
      try { this.send({ id, method, params }); } catch (error) { this.fail(error as Error); }
    });
  }

  private fail(error: Error) {
    if (this.dead) return;
    this.dead = true;
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear();
    this.documents.clear();
    this.child.kill("SIGKILL");
  }

  async query(method: "hover" | "definition", file: string, line: number, column: number, signal?: AbortSignal): Promise<any> {
    checkSignal(signal);
    const operation = this.queue.then(async () => {
      checkSignal(signal);
      await waitFor(this.ready, signal);
      checkSignal(signal);
      const text = await readFile(file, "utf8");
      checkSignal(signal);
      const lines = text.split(/\r\n|\n|\r/);
      if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1 || line > lines.length || column > lines[line - 1]!.length + 1) {
        throw new Error("Position is outside the file. line and column must be positive, 1-based UTF-16 positions.");
      }
      const uri = pathToFileURL(file).href;
      // Open headers also act as editor buffers in clangd: refresh them before
      // querying another translation unit so saved-file changes cannot go stale.
      for (const [openUri, document] of this.documents) {
        if (openUri === uri) continue;
        let current: string;
        try { current = await readFile(fileURLToPath(openUri), "utf8"); }
        catch {
          this.send({ method: "textDocument/didClose", params: { textDocument: { uri: openUri } } });
          this.documents.delete(openUri);
          continue;
        }
        checkSignal(signal);
        if (current !== document.text) {
          const version = document.version + 1;
          this.send({ method: "textDocument/didChange", params: { textDocument: { uri: openUri, version }, contentChanges: [{ text: current }] } });
          this.documents.set(openUri, { text: current, version });
        }
      }
      const previous = this.documents.get(uri);
      const version = (previous?.version ?? 0) + 1;
      // clangd can retain dependent preambles after full didChange updates.
      // Reopen the queried translation unit to rebuild from saved dependencies.
      if (previous) this.send({ method: "textDocument/didClose", params: { textDocument: { uri } } });
      this.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: extname(file) === ".c" ? "c" : "cpp", version, text } } });
      this.documents.set(uri, { text, version });
      return this.request(`textDocument/${method}`, { textDocument: { uri }, position: { line: line - 1, character: column - 1 } }, signal);
    });
    this.queue = operation.catch(() => {});
    return waitFor(operation, signal);
  }

  async close() {
    if (this.dead || this.closing) return;
    this.closing = true;
    const timer = setTimeout(() => this.fail(new Error("clangd shutdown timed out")), 1000);
    try {
      await this.ready;
      await this.request("shutdown", null);
      this.send({ method: "exit" });
    } catch { /* failed or crashed servers are already stopped */ }
    finally {
      clearTimeout(timer);
      this.fail(new Error("clangd session shut down"));
    }
  }
}

function hoverText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(hoverText).join("\n\n");
  return typeof value.value === "string" ? value.value : "";
}
function bounded(text: string) {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[clangd output truncated]` : text;
}
function location(value: any) {
  const uri = value.targetUri ?? value.uri;
  const range = value.targetSelectionRange ?? value.range;
  if (typeof uri !== "string" || !range?.start || !range?.end) throw new Error("clangd returned an invalid definition location");
  return {
    file: uri.startsWith("file:") ? fileURLToPath(uri) : uri,
    line: range.start.line + 1, column: range.start.character + 1,
    endLine: range.end.line + 1, endColumn: range.end.character + 1,
  };
}

export function registerClangdTools(pi: ExtensionAPI, options: ClangdOptions = {}) {
  const connections = new Map<string, ClangdConnection>();
  pi.on("session_shutdown", async () => {
    await Promise.all([...connections.values()].map(connection => connection.close()));
    connections.clear();
  });
  for (const method of ["hover", "definition"] as const) {
    pi.registerTool({
      name: `cpp_${method}`, label: method === "hover" ? "C++ Hover" : "C++ Definition",
      description: method === "hover" ? "Get C/C++ symbol types, signatures and documentation using clangd." : "Find C/C++ symbol definitions using clangd. Returns 1-based UTF-16 locations.",
      promptSnippet: method === "hover" ? "Inspect C/C++ symbol types and documentation with clangd" : "Find C/C++ symbol definition locations with clangd",
      parameters: Type.Object({
        file: Type.String({ description: "Source path, absolute or relative to the project cwd" }),
        line: Type.Integer({ minimum: 1, description: "1-based line" }),
        column: Type.Integer({ minimum: 1, description: "1-based UTF-16 column (JavaScript string offsets + 1)" }),
        build_dir: Type.Optional(Type.String({ description: "Directory containing compile_commands.json, relative to project cwd; otherwise clangd searches source ancestors" })),
      }),
      async execute(_id, params, signal, _onUpdate, ctx) {
        const file = resolve(ctx.cwd, params.file);
        const buildDir = params.build_dir === undefined ? undefined : resolve(ctx.cwd, params.build_dir);
        const base = { file, line: params.line, column: params.column, build_dir: buildDir };
        try {
          checkSignal(signal);
          // Fail locally before starting a server for nonexistent or unreadable input.
          await readFile(file, "utf8");
          if (buildDir) {
            try { await readFile(resolve(buildDir, "compile_commands.json"), "utf8"); }
            catch { throw new Error(`No readable compile_commands.json in build_dir: ${buildDir}. Generate a compilation database first.`); }
          }
          const key = JSON.stringify([resolve(ctx.cwd), buildDir]);
          let connection = connections.get(key);
          if (!connection?.alive) {
            connection = new ClangdConnection(resolve(ctx.cwd), buildDir, options);
            connections.set(key, connection);
          }
          const result = await connection.query(method, file, params.line, params.column, signal);
          if (method === "hover") {
            const text = bounded(hoverText(result?.contents));
            return { content: [{ type: "text", text: text || "No hover information at this position." }], details: { ...base, found: !!text, hover: text } };
          }
          const all = result ? (Array.isArray(result) ? result : [result]) : [];
          const locations = all.slice(0, 100).map(location);
          const text = locations.length ? locations.map(item => `${item.file}:${item.line}:${item.column}`).join("\n") : "No definition found at this position.";
          return { content: [{ type: "text", text: bounded(text) }], details: { ...base, found: locations.length > 0, locations, truncated: all.length > locations.length } };
        } catch (error) {
          const message = bounded((error as Error).message);
          return { isError: true, content: [{ type: "text", text: message }], details: { ...base, error: true, message } };
        }
      },
    });
  }
}
