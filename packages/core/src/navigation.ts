import { Type, type TSchema } from "typebox";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bounded, ClangdUnsupportedError, location, position, waitFor, type ClangdConnection, type IndexState, type ManagedClangd } from "./clangd.ts";
import type { ToolResult, ToolSpec } from "./tools.ts";

/** Entries listed per result; the rest are counted as omitted. */
const MAX_ENTRIES = 100;
/** Outline entries listed for one file. */
const MAX_OUTLINE = 300;

/** The clangd version that first implements each hierarchy method (KTD12). */
const VERSION_NEEDED: Record<string, string> = {
  "textDocument/prepareCallHierarchy": "call hierarchy needs clangd 12 or newer",
  "callHierarchy/incomingCalls": "call hierarchy needs clangd 12 or newer",
  "callHierarchy/outgoingCalls": "outgoing calls need clangd 21 or newer",
  "textDocument/prepareTypeHierarchy": "type hierarchy needs clangd 16 or newer",
  "typeHierarchy/supertypes": "type hierarchy needs clangd 16 or newer",
  "typeHierarchy/subtypes": "type hierarchy needs clangd 16 or newer",
};

const NO_PROJECT = "Navigation needs the CMake project model and its managed clangd index, and none is ready: this is not a CMake project, or its configure is still running or failed. Check with cpp_project; cpp_hover and cpp_definition work without the model.";

// LSP SymbolKind, 1-based.
const SYMBOL_KINDS = ["", "file", "module", "namespace", "package", "class", "method", "property", "field", "constructor", "enum", "interface", "function", "variable", "constant", "string", "number", "boolean", "array", "object", "key", "null", "enumerator", "struct", "event", "operator", "type parameter"];
function kindName(kind: unknown): string { return (typeof kind === "number" && SYMBOL_KINDS[kind]) || "symbol"; }

/** R26: index-dependent results say when the background index is not idle yet ("not started" counts as incomplete). */
function indexNote(state: IndexState): string | undefined {
  if (state === "idle") return undefined;
  return state === "indexing" ? "[index still building; results may be incomplete]" : "[index not started; results may be incomplete]";
}

function at(value: { file: string; line: number; column: number }) { return `${value.file}:${value.line}:${value.column}`; }
function itemLocation(item: any) { return location({ uri: item?.uri, range: item?.selectionRange ?? item?.range }); }
function omitted(count: number, noun: string) { return count > 0 ? [`[${count} more ${noun} omitted]`] : []; }

interface Answer { text: string; details: Record<string, unknown>; found: boolean }
type Connect = () => Promise<ClangdConnection>;
interface NavigationTool {
  name: string; label: string; description: string; promptSnippet: string; parameters: TSchema;
  /** Whether the result depends on the background index (R26). */
  indexed(params: any): boolean;
  run(params: any, cwd: string, connect: Connect, signal?: AbortSignal): Promise<Answer>;
}

const positionParameters = {
  file: Type.String({ description: "Source or header path, absolute or relative to the project cwd" }),
  line: Type.Integer({ minimum: 1, description: "1-based line" }),
  column: Type.Integer({ minimum: 1, description: "1-based UTF-16 column (JavaScript string offsets + 1)" }),
};

const references: NavigationTool = {
  name: "cpp_references", label: "C++ References",
  description: "Find all references to the C/C++ symbol at a position across the CMake project, using clangd's project index. Returns 1-based file:line:column locations, including the declaration and definition.",
  promptSnippet: "Find every reference to a C/C++ symbol with clangd instead of grep",
  parameters: Type.Object(positionParameters),
  indexed: () => true,
  async run(params, cwd, connect, signal) {
    const input = await position(cwd, params);
    const result = await (await connect()).request("textDocument/references", { ...input.request, context: { includeDeclaration: true } }, { file: input.file, signal });
    const all: any[] = Array.isArray(result) ? result : [];
    const locations = all.slice(0, MAX_ENTRIES).map(location);
    const text = locations.length ? [...locations.map(at), ...omitted(all.length - locations.length, "references")].join("\n") : "No references found at this position.";
    return { text, found: locations.length > 0, details: { file: input.file, line: input.line, column: input.column, locations, omitted: all.length - locations.length } };
  },
};

function outline(symbols: any[], lines: string[], depth: number): number {
  let total = 0;
  for (const symbol of symbols) {
    total++;
    if (lines.length < MAX_OUTLINE) {
      const start = (symbol.selectionRange ?? symbol.location?.range ?? symbol.range)?.start;
      const kind = kindName(symbol.kind);
      const detail = symbol.detail && symbol.detail !== kind ? `: ${symbol.detail}` : "";
      lines.push(`${"  ".repeat(depth)}${kind} ${symbol.name}${detail}${start ? `  ${start.line + 1}:${start.character + 1}` : ""}`);
    }
    if (Array.isArray(symbol.children)) total += outline(symbol.children, lines, depth + 1);
  }
  return total;
}

const symbols: NavigationTool = {
  name: "cpp_symbols", label: "C++ Symbols",
  description: "Search C/C++ symbols by name across the CMake project (query), or list the outline of one file (file) with members nested under their class. Returns 1-based locations.",
  promptSnippet: "Search C/C++ symbols by name across the project, or outline a file, with clangd",
  parameters: Type.Object({
    query: Type.Optional(Type.String({ minLength: 1, description: "Symbol name or fuzzy fragment to search the whole project for" })),
    file: Type.Optional(Type.String({ minLength: 1, description: "File to outline, absolute or relative to the project cwd" })),
  }),
  indexed: params => params.query !== undefined,
  async run(params, cwd, connect, signal) {
    if ((params.query === undefined) === (params.file === undefined)) {
      throw new Error("cpp_symbols takes either query or file: query searches the project by name, file outlines one file.");
    }
    if (params.query !== undefined) {
      const result = await (await connect()).request("workspace/symbol", { query: params.query }, { signal });
      const all: any[] = Array.isArray(result) ? result : [];
      const found = all.slice(0, MAX_ENTRIES).map(symbol => ({
        name: symbol.containerName ? `${symbol.containerName}::${symbol.name}` : symbol.name,
        kind: kindName(symbol.kind),
        ...location(symbol.location ?? symbol),
      }));
      const text = found.length
        ? [...found.map(symbol => `${at(symbol)}  ${symbol.kind} ${symbol.name}`), ...omitted(all.length - found.length, "symbols")].join("\n")
        : `No symbols match "${params.query}".`;
      return { text, found: found.length > 0, details: { query: params.query, symbols: found, omitted: all.length - found.length } };
    }
    const file = resolve(cwd, params.file);
    await readFile(file, "utf8");
    const result = await (await connect()).request("textDocument/documentSymbol", { textDocument: { uri: pathToFileURL(file).href } }, { file, signal });
    const lines: string[] = [];
    const total = outline(Array.isArray(result) ? result : [], lines, 0);
    const text = total ? [file, ...lines, ...omitted(total - lines.length, "outline entries")].join("\n") : `No symbols in ${file}.`;
    return { text, found: total > 0, details: { file, outline: lines, omitted: total - lines.length } };
  },
};

/** Runs `prepare` at the position, then `method` for each prepared item. */
async function hierarchy(params: any, cwd: string, connect: Connect, signal: AbortSignal | undefined, prepare: string, method: string) {
  const input = await position(cwd, params);
  const connection = await connect();
  const prepared = await connection.request(prepare, input.request, { file: input.file, signal });
  const items: any[] = Array.isArray(prepared) ? prepared : [];
  const results: { from: any; result: any[] }[] = [];
  for (const item of items) {
    const result = await connection.request(method, { item }, { signal });
    results.push({ from: item, result: Array.isArray(result) ? result : [] });
  }
  return { input, items, results };
}

const calls: NavigationTool = {
  name: "cpp_calls", label: "C++ Calls",
  description: "List the incoming calls (callers) or outgoing calls (callees) of the C/C++ function at a position, using clangd's call hierarchy and project index. Returns 1-based locations.",
  promptSnippet: "Find the callers or callees of a C/C++ function with clangd",
  parameters: Type.Object({
    ...positionParameters,
    direction: Type.Enum(["incoming", "outgoing"], { description: "incoming (who calls it) | outgoing (what it calls)" }),
  }),
  indexed: () => true,
  async run(params, cwd, connect, signal) {
    const { input, items, results } = await hierarchy(params, cwd, connect, signal, "textDocument/prepareCallHierarchy", `callHierarchy/${params.direction}Calls`);
    const incoming = params.direction === "incoming";
    const verb = incoming ? "calls it at" : "called at";
    const base = { file: input.file, line: input.line, column: input.column, direction: params.direction };
    if (!items.length) return { text: "No function at this position.", found: false, details: { ...base, calls: [], omitted: 0 } };
    const entries = results.flatMap(({ from, result }) => result.map(call => {
      const other = incoming ? call.from : call.to;
      // Call sites lie in the caller: the listed function for incoming calls, the queried one for outgoing calls.
      const siteFile = itemLocation(incoming ? other : from).file;
      const sites = (Array.isArray(call.fromRanges) ? call.fromRanges : []).map((range: any) => location({ uri: pathToFileURL(siteFile).href, range }));
      return { name: other?.name as string, ...itemLocation(other), sites };
    }));
    const shown = entries.slice(0, MAX_ENTRIES);
    const lines = shown.map(entry => {
      const sites = entry.sites.map((site: any) => incoming ? `${site.line}:${site.column}` : at(site)).join(", ");
      return `${at(entry)}  ${entry.name}${sites ? `  (${verb} ${sites})` : ""}`;
    });
    const name = items.map(item => item.name).join(", ");
    const text = shown.length
      ? [...lines, ...omitted(entries.length - shown.length, "calls")].join("\n")
      : `No ${params.direction} calls found for ${name}.`;
    return { text, found: shown.length > 0, details: { ...base, calls: shown, omitted: entries.length - shown.length } };
  },
};

const types: NavigationTool = {
  name: "cpp_types", label: "C++ Types",
  description: "List the base classes (supertypes) or derived classes (subtypes) of the C/C++ type at a position, using clangd's type hierarchy and project index. Returns 1-based locations.",
  promptSnippet: "Find the base or derived classes of a C++ type with clangd",
  parameters: Type.Object({
    ...positionParameters,
    direction: Type.Enum(["supertypes", "subtypes"], { description: "supertypes (base classes) | subtypes (derived classes)" }),
  }),
  indexed: () => true,
  async run(params, cwd, connect, signal) {
    const { input, items, results } = await hierarchy(params, cwd, connect, signal, "textDocument/prepareTypeHierarchy", `typeHierarchy/${params.direction}`);
    const base = { file: input.file, line: input.line, column: input.column, direction: params.direction };
    if (!items.length) return { text: "No type at this position.", found: false, details: { ...base, types: [], omitted: 0 } };
    const entries = results.flatMap(({ result }) => result.map(item => ({ name: item.name as string, kind: kindName(item.kind), ...itemLocation(item) })));
    const shown = entries.slice(0, MAX_ENTRIES);
    const name = items.map(item => item.name).join(", ");
    const text = shown.length
      ? [...shown.map(entry => `${at(entry)}  ${entry.kind} ${entry.name}`), ...omitted(entries.length - shown.length, "types")].join("\n")
      : `No ${params.direction} found for ${name}.`;
    return { text, found: shown.length > 0, details: { ...base, types: shown, omitted: entries.length - shown.length } };
  },
};

/**
 * cpp_references, cpp_symbols, cpp_calls and cpp_types. They always use the session's managed,
 * background-indexed clangd connection: a connection for an explicit build_dir has no index, so
 * project-wide answers from it would be silently partial. Without a session or a ready project
 * model the tools return an error that says so.
 */
export function navigationToolSpecs(managed: () => Pick<ManagedClangd, "connection"> | undefined): ToolSpec[] {
  return [references, symbols, calls, types].map(tool => ({
    name: tool.name, label: tool.label, description: tool.description, promptSnippet: tool.promptSnippet, parameters: tool.parameters,
    async execute(params: unknown, { cwd, signal }): Promise<ToolResult> {
      let connection: ClangdConnection | undefined;
      const connect: Connect = async () => {
        connection = await waitFor(managed()?.connection() ?? Promise.resolve(undefined), signal);
        if (!connection) throw new Error(NO_PROJECT);
        return connection;
      };
      try {
        const answer = await tool.run(params, cwd, connect, signal);
        const note = tool.indexed(params) && connection ? indexNote(connection.indexState) : undefined;
        const text = bounded(answer.text) + (note ? `\n${note}` : "");
        return { content: [{ type: "text", text }], details: { ...answer.details, found: answer.found, indexState: connection?.indexState } };
      } catch (error) {
        if (error instanceof ClangdUnsupportedError) {
          const needed = VERSION_NEEDED[error.method];
          const text = `${error.message}${needed ? ` (${needed})` : ""}.`;
          return { content: [{ type: "text", text }], details: { supported: false, method: error.method, message: text } };
        }
        const message = bounded((error as Error).message);
        return { isError: true, content: [{ type: "text", text: message }], details: { error: true, message } };
      }
    },
  }));
}
