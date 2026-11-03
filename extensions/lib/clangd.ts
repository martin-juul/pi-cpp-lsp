import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProjectModel } from "./project/model.ts";
import type { ProjectService } from "./project/session.ts";

const MAX_MESSAGE = 16 * 1024 * 1024;
const MAX_OUTPUT = 24_000;
type Message = { id?: number | string; method?: string; params?: any; result?: any; error?: { message: string; code?: number } };
type Pending = { resolve(value: any): void; reject(error: Error): void; cleanup(): void };
/** `args` precede the default flags; `extraArgs` follow them, so a repeated flag such as `--background-index` overrides the default. */
export interface ClangdOptions { command?: string; args?: string[]; extraArgs?: string[]; timeoutMs?: number }
export type IndexState = "not-started" | "indexing" | "idle";
export interface Diagnostic { range: { start: { line: number; character: number }; end: { line: number; character: number } }; severity?: number; code?: number | string; source?: string; message: string; [key: string]: unknown }
/** "pending" means no diagnostics for the version arrived in time; it never means "no problems". */
export type DiagnosticsResult = { status: "ready"; version: number; diagnostics: Diagnostic[] } | { status: "pending" };
type DiagnosticsWaiter = { uri: string; version: number; resolve(result: DiagnosticsResult): void };

/** clangd's work-done progress token for background indexing. */
const INDEX_TOKEN = "backgroundIndexProgress";
const METHOD_NOT_FOUND = -32601;

/** The connected clangd does not implement an LSP method. */
export class ClangdUnsupportedError extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`${method} is not supported by this clangd version`);
    this.name = "ClangdUnsupportedError";
    this.method = method;
  }
}

function aborted(): Error { return new Error("clangd request cancelled"); }
function checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw aborted(); }
export function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
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
  private capabilities: any = {};
  private diagnostics = new Map<string, { version?: number; diagnostics: Diagnostic[] }>();
  private diagnosticsWaiters = new Set<DiagnosticsWaiter>();
  private index: IndexState = "not-started";
  private indexWaiters = new Set<() => void>();
  private unsupported = new Set<string>();
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
      ...(options.extraArgs ?? []),
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
    const result = await this.call("initialize", {
      processId: process.pid, rootUri: pathToFileURL(this.cwd).href,
      workspaceFolders: [{ uri: pathToFileURL(this.cwd).href, name: this.cwd }],
      capabilities: {
        general: { positionEncodings: ["utf-16"] }, offsetEncoding: ["utf-16"],
        window: { workDoneProgress: true },
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          publishDiagnostics: { versionSupport: true, relatedInformation: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          rename: { prepareSupport: true },
          callHierarchy: {}, typeHierarchy: {},
        },
      },
    });
    this.capabilities = result?.capabilities ?? {};
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
            if (message.method === "window/workDoneProgress/create") this.send({ id: message.id, result: null });
            else if (message.method === "workspace/configuration") this.send({ id: message.id, result: (message.params?.items ?? []).map(() => null) });
            else if (message.method === "workspace/workspaceFolders") this.send({ id: message.id, result: [{ uri: pathToFileURL(this.cwd).href, name: this.cwd }] });
            else this.send({ id: message.id, error: { code: METHOD_NOT_FOUND, message: `Unsupported client method: ${message.method}` } });
          } else if (message.method === "$/progress") this.progress(message.params);
          else if (message.method === "textDocument/publishDiagnostics") this.publishDiagnostics(message.params);
          continue;
        }
        const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
        if (pending) {
          this.pending.delete(message.id as number);
          pending.cleanup();
          if (message.error) pending.reject(message.error.code === METHOD_NOT_FOUND ? Object.assign(new Error("method not found"), { methodNotFound: true }) : new Error(`clangd: ${message.error.message} (${message.error.code})`));
          else pending.resolve(message.result);
        }
      }
    } catch (error) { this.fail(new Error(`Invalid clangd protocol: ${(error as Error).message}`)); }
  }

  private progress(params: any) {
    if (params?.token !== INDEX_TOKEN) return;
    const kind = params.value?.kind;
    if (kind === "begin" || kind === "report") this.index = "indexing";
    else if (kind === "end") {
      this.index = "idle";
      for (const wake of this.indexWaiters) wake();
    }
  }

  private publishDiagnostics(params: any) {
    if (typeof params?.uri !== "string") return;
    const entry = { version: typeof params.version === "number" ? params.version : undefined, diagnostics: Array.isArray(params.diagnostics) ? params.diagnostics : [] };
    this.diagnostics.set(params.uri, entry);
    for (const waiter of this.diagnosticsWaiters) {
      if (waiter.uri === params.uri && entry.version !== undefined && entry.version >= waiter.version) waiter.resolve({ status: "ready", version: entry.version, diagnostics: entry.diagnostics });
    }
  }

  /** Sends one request. A method-not-found reply is remembered and later calls fail without a request. */
  private call(method: string, params: unknown, signal?: AbortSignal): Promise<any> {
    checkSignal(signal);
    if (this.unsupported.has(method)) return Promise.reject(new ClangdUnsupportedError(method));
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
    }).catch((error: Error & { methodNotFound?: boolean }) => {
      if (!error.methodNotFound) throw error;
      this.unsupported.add(method);
      throw new ClangdUnsupportedError(method);
    });
  }

  private fail(error: Error) {
    if (this.dead) return;
    this.dead = true;
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear();
    this.documents.clear();
    this.diagnostics.clear();
    this.child.kill("SIGKILL");
  }

  /** Runs one operation at a time, after initialization, so document versions stay ordered. */
  private serialize<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    checkSignal(signal);
    const run = this.queue.then(async () => {
      checkSignal(signal);
      await waitFor(this.ready, signal);
      checkSignal(signal);
      return operation();
    });
    this.queue = run.catch(() => {});
    return waitFor(run, signal);
  }

  /**
   * Refreshes every open document from disk and, when `file` is given,
   * reopens it from disk. `check` can reject the saved text before anything
   * is sent. Must run inside `serialize`.
   */
  private async refresh(file: string | undefined, signal?: AbortSignal, check?: (text: string) => void) {
    const text = file === undefined ? undefined : await readFile(file, "utf8");
    checkSignal(signal);
    if (text !== undefined) check?.(text);
    const uri = file === undefined ? undefined : pathToFileURL(file).href;
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
    if (file === undefined || uri === undefined || text === undefined) return undefined;
    const previous = this.documents.get(uri);
    const version = (previous?.version ?? 0) + 1;
    // clangd can retain dependent preambles after full didChange updates.
    // Reopen the queried translation unit to rebuild from saved dependencies.
    if (previous) this.send({ method: "textDocument/didClose", params: { textDocument: { uri } } });
    this.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: extname(file) === ".c" ? "c" : "cpp", version, text } } });
    this.documents.set(uri, { text, version });
    return { uri, version };
  }

  /** Server capabilities from the `initialize` result. */
  async serverCapabilities(): Promise<any> {
    await this.ready;
    return this.capabilities;
  }

  /** Background index state; "not-started" until clangd reports progress, and it counts as incomplete. */
  get indexState(): IndexState { return this.index; }

  /** Waits up to `timeoutMs` for the background index to be idle and returns the state reached. */
  waitForIndexIdle(timeoutMs: number, signal?: AbortSignal): Promise<IndexState> {
    if (this.index === "idle") return Promise.resolve(this.index);
    return waitFor(new Promise<IndexState>(done => {
      const finish = () => { clearTimeout(timer); this.indexWaiters.delete(finish); done(this.index); };
      const timer = setTimeout(finish, timeoutMs);
      this.indexWaiters.add(finish);
    }), signal);
  }

  /** The text clangd last received for `file`, or undefined when it is not open (clangd then reads it from disk). */
  syncedText(file: string): string | undefined {
    return this.documents.get(pathToFileURL(file).href)?.text;
  }

  /** Opens `file` from disk (and refreshes other open documents); returns the version clangd now has. */
  syncFile(file: string, signal?: AbortSignal): Promise<{ uri: string; version: number }> {
    return this.serialize(signal, async () => (await this.refresh(file, signal))!);
  }

  /**
   * Waits up to `timeoutMs` for diagnostics of `file` at `version` or newer.
   * Older versions are ignored; a timeout returns `{ status: "pending" }`.
   */
  waitForDiagnostics(file: string, version: number, timeoutMs: number, signal?: AbortSignal): Promise<DiagnosticsResult> {
    const uri = pathToFileURL(file).href;
    const stored = this.diagnostics.get(uri);
    if (stored?.version !== undefined && stored.version >= version) return Promise.resolve({ status: "ready", version: stored.version, diagnostics: stored.diagnostics });
    return waitFor(new Promise<DiagnosticsResult>(done => {
      const waiter: DiagnosticsWaiter = { uri, version, resolve: result => { clearTimeout(timer); this.diagnosticsWaiters.delete(waiter); done(result); } };
      const timer = setTimeout(() => waiter.resolve({ status: "pending" }), timeoutMs);
      this.diagnosticsWaiters.add(waiter);
    }), signal);
  }

  /**
   * Sends an LSP request and returns its result. Open documents are refreshed
   * from disk first, and `file`, when given, is reopened from disk. Rejects
   * with `ClangdUnsupportedError` when clangd lacks the method.
   */
  request(method: string, params: unknown, options: { file?: string; signal?: AbortSignal } = {}): Promise<any> {
    const { file, signal } = options;
    checkSignal(signal);
    if (this.unsupported.has(method)) return Promise.reject(new ClangdUnsupportedError(method));
    return this.serialize(signal, async () => {
      await this.refresh(file, signal);
      return this.call(method, params, signal);
    });
  }

  async query(method: "hover" | "definition", file: string, line: number, column: number, signal?: AbortSignal): Promise<any> {
    return this.serialize(signal, async () => {
      const synced = await this.refresh(file, signal, text => {
        const lines = text.split(/\r\n|\n|\r/);
        if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1 || line > lines.length || column > lines[line - 1]!.length + 1) {
          throw new Error("Position is outside the file. line and column must be positive, 1-based UTF-16 positions.");
        }
      });
      return this.call(`textDocument/${method}`, { textDocument: { uri: synced!.uri }, position: { line: line - 1, character: column - 1 } }, signal);
    });
  }

  async close() {
    if (this.dead || this.closing) return;
    this.closing = true;
    const timer = setTimeout(() => this.fail(new Error("clangd shutdown timed out")), 1000);
    try {
      await this.ready;
      await this.call("shutdown", null);
      this.send({ method: "exit" });
    } catch { /* failed or crashed servers are already stopped */ }
    finally {
      clearTimeout(timer);
      this.fail(new Error("clangd session shut down"));
    }
  }
}

/** Index flags of the managed connection (KTD11); the rename limit is lifted so widely used symbols can be renamed. */
const MANAGED_FLAGS = ["--background-index", "--background-index-priority=low", "--rename-file-limit=0"];
const helpTexts = new Map<string, Promise<string | undefined>>();

/** `clangd --help` output, once per command line; undefined when it cannot be read. */
function clangdHelp(command: string, args: string[]): Promise<string | undefined> {
  const key = JSON.stringify([command, args]);
  let help = helpTexts.get(key);
  if (!help) {
    help = new Promise(done => execFile(command, [...args, "--help"], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      done(error && !stdout ? undefined : `${stdout}\n${stderr}`);
    }));
    helpTexts.set(key, help);
  }
  return help;
}

/** The managed index flags this clangd lists in `--help`; older versions reject unknown flags at startup. */
async function managedFlags(options: ClangdOptions): Promise<string[]> {
  const help = await clangdHelp(options.command ?? "clangd", options.args ?? []);
  if (help === undefined) return MANAGED_FLAGS;
  return MANAGED_FLAGS.filter(flag => new RegExp(`(^|\\s)${flag.split("=")[0]}(=|\\s|$)`, "m").test(help));
}

/** The parts of the project service the managed connection uses. */
export type ManagedProject = Pick<ProjectService, "model" | "onModelChange">;

/** A compiled, existing project source, opened so clangd starts indexing (clangd indexes nothing until a file is opened). */
function firstProjectSource(model: ProjectModel): string | undefined {
  for (const target of model.targets) {
    if (!target.isProjectTarget) continue;
    for (const source of target.sources) {
      if (!source.isGenerated && source.language !== undefined && existsSync(source.path)) return source.path;
    }
  }
  return undefined;
}

/**
 * One clangd connection per session against the managed compile database, with a background index
 * kept beside that database, outside the project tree (KTD11). It starts as soon as the project
 * model is ready, restarts when `compile_commands.json` changes, and restarts on the next use after
 * a crash or timeout.
 */
export class ManagedClangd {
  private project?: ManagedProject;
  private unsubscribe?: () => void;
  private current?: ClangdConnection;
  private starting?: Promise<void>;
  private generation = 0;
  private readonly options: ClangdOptions;

  constructor(options: ClangdOptions = {}) {
    this.options = options;
  }

  /** Follows `project`; a different project closes the old connection. Call it whenever the session's project may have changed. */
  attach(project: ManagedProject | undefined): void {
    if (project === this.project) return;
    this.detach();
    this.project = project;
    if (!project) return;
    this.unsubscribe = project.onModelChange(change => {
      if (change.compileDatabaseChanged || !this.current?.alive) this.start(change.model);
    });
    if (project.model) this.start(project.model);
  }

  /**
   * The managed connection, or undefined while no model is ready. A dead connection is restarted;
   * one that fails while starting is returned anyway, so its error reaches the caller.
   */
  async connection(): Promise<ClangdConnection | undefined> {
    const model = this.project?.model;
    if (!model) return undefined;
    if (!this.starting && !this.current?.alive) this.start(model);
    await this.starting;
    return this.current;
  }

  private start(model: ProjectModel): void {
    const generation = ++this.generation;
    const previous = this.current;
    this.current = undefined;
    void previous?.close();
    const starting = (async () => {
      const flags = await managedFlags(this.options);
      if (generation !== this.generation) return;
      const connection = new ClangdConnection(model.sourceRoot, model.buildDir, { ...this.options, extraArgs: [...(this.options.extraArgs ?? []), ...flags] });
      this.current = connection;
      const source = firstProjectSource(model);
      // A failed open surfaces on the next request; the connection is restarted then.
      if (source) await connection.syncFile(source).catch(() => {});
    })();
    this.starting = starting;
    void starting.finally(() => { if (this.starting === starting) this.starting = undefined; });
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.project = undefined;
    this.generation++;
    const previous = this.current;
    this.current = undefined;
    void previous?.close();
  }

  /** Stops following the project and shuts the connection down. */
  async close(): Promise<void> {
    const previous = this.current;
    this.detach();
    await previous?.close();
  }
}

function hoverText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(hoverText).join("\n\n");
  return typeof value.value === "string" ? value.value : "";
}
export function bounded(text: string) {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[clangd output truncated]` : text;
}
export function location(value: any) {
  const uri = value.targetUri ?? value.uri;
  const range = value.targetSelectionRange ?? value.range;
  if (typeof uri !== "string" || !range?.start || !range?.end) throw new Error("clangd returned an invalid definition location");
  return {
    file: uri.startsWith("file:") ? fileURLToPath(uri) : uri,
    line: range.start.line + 1, column: range.start.character + 1,
    endLine: range.end.line + 1, endColumn: range.end.character + 1,
  };
}

export interface ClangdToolOptions extends ClangdOptions {
  /** The session's project service; with a ready model, calls without `build_dir` use the managed connection (KTD16). */
  getProject?: () => ManagedProject | undefined;
}

/**
 * Registers cpp_hover and cpp_definition and returns the session's managed connection for other
 * tools. Register after the handler that creates the project service, so `session_start` sees it;
 * otherwise the managed connection attaches at the next agent start or tool call.
 */
export function registerClangdTools(pi: ExtensionAPI, toolOptions: ClangdToolOptions = {}): ManagedClangd {
  const { getProject, ...options } = toolOptions;
  const connections = new Map<string, ClangdConnection>();
  const managed = new ManagedClangd(options);
  const follow = () => { if (getProject) managed.attach(getProject()); };
  pi.on("session_start", async () => { follow(); });
  pi.on("agent_start", async () => { follow(); });
  pi.on("session_shutdown", async () => {
    await Promise.all([...connections.values()].map(connection => connection.close()));
    connections.clear();
    await managed.close();
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
        build_dir: Type.Optional(Type.String({ description: "Directory containing compile_commands.json, relative to project cwd; otherwise the managed CMake build directory once the project model is ready, else clangd searches source ancestors" })),
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
          follow();
          let connection = buildDir === undefined ? await waitFor(managed.connection(), signal) : undefined;
          // The result names the managed compile database it used (KTD16).
          const used = connection ? { ...base, build_dir: connection.buildDir, managed: true } : base;
          const note = connection ? `\n[compile database: ${connection.buildDir} (managed)]` : "";
          if (!connection) {
            const key = JSON.stringify([resolve(ctx.cwd), buildDir]);
            connection = connections.get(key);
            if (!connection?.alive) {
              connection = new ClangdConnection(resolve(ctx.cwd), buildDir, options);
              connections.set(key, connection);
            }
          }
          const result = await connection.query(method, file, params.line, params.column, signal);
          if (method === "hover") {
            const text = bounded(hoverText(result?.contents));
            return { content: [{ type: "text", text: (text || "No hover information at this position.") + note }], details: { ...used, found: !!text, hover: text } };
          }
          const all = result ? (Array.isArray(result) ? result : [result]) : [];
          const locations = all.slice(0, 100).map(location);
          const text = locations.length ? locations.map(item => `${item.file}:${item.line}:${item.column}`).join("\n") : "No definition found at this position.";
          return { content: [{ type: "text", text: bounded(text) + note }], details: { ...used, found: locations.length > 0, locations, truncated: all.length > locations.length } };
        } catch (error) {
          const message = bounded((error as Error).message);
          return { isError: true, content: [{ type: "text", text: message }], details: { ...base, error: true, message } };
        }
      },
    });
  }
  return managed;
}
