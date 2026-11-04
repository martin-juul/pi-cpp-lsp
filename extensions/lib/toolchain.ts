import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ClangdConnection, type ClangdOptions } from "./clangd.ts";
import { probeInvocation, type CompilationEntry } from "./compdb.ts";
import type { Exec } from "./project/configure.ts";

/** A C++26 feature with a feature-test macro (R3). */
export interface Feature {
  id: string;
  /** How the briefing and notes name it. */
  label: string;
  kind: "language" | "library";
  macro: string;
  /** The value the C++26 working paper gives the macro. */
  min: number;
  /** A preprocessor condition that also counts as present (KTD1), e.g. clang's `#embed` without its macro. */
  alternative?: string;
  /** The flag that enables the feature, per compiler family (KTD3). */
  enable?: Partial<Record<Family, string>>;
}

export type Family = "gcc" | "clang" | "unknown";

const REFLECTION_FLAGS = { gcc: "-freflection" };

export const CXX26_FEATURES: readonly Feature[] = [
  { id: "reflection", label: "static reflection", kind: "language", macro: "__cpp_impl_reflection", min: 202506, enable: REFLECTION_FLAGS },
  { id: "contracts", label: "contracts", kind: "language", macro: "__cpp_contracts", min: 202502 },
  { id: "pack_indexing", label: "pack indexing", kind: "language", macro: "__cpp_pack_indexing", min: 202311 },
  { id: "embed", label: "#embed", kind: "language", macro: "__cpp_pp_embed", min: 202502, alternative: "defined(__has_embed)" },
  { id: "expansion_statements", label: "expansion statements", kind: "language", macro: "__cpp_expansion_statements", min: 202506 },
  { id: "constexpr_exceptions", label: "constexpr exceptions", kind: "language", macro: "__cpp_constexpr_exceptions", min: 202411 },
  { id: "placeholder_variables", label: "the _ placeholder", kind: "language", macro: "__cpp_placeholder_variables", min: 202306 },
  { id: "deleted_function", label: "= delete(\"reason\")", kind: "language", macro: "__cpp_deleted_function", min: 202403 },
  { id: "structured_binding_packs", label: "structured binding packs", kind: "language", macro: "__cpp_structured_bindings", min: 202411 },
  { id: "variadic_friend", label: "variadic friends", kind: "language", macro: "__cpp_variadic_friend", min: 202403 },
  { id: "trivial_relocatability", label: "trivial relocatability", kind: "language", macro: "__cpp_trivial_relocatability", min: 202502 },
  { id: "meta", label: "<meta>", kind: "library", macro: "__cpp_lib_reflection", min: 202506, enable: REFLECTION_FLAGS },
  { id: "inplace_vector", label: "std::inplace_vector", kind: "library", macro: "__cpp_lib_inplace_vector", min: 202406 },
  { id: "saturation_arithmetic", label: "saturation arithmetic", kind: "library", macro: "__cpp_lib_saturation_arithmetic", min: 202311 },
  { id: "text_encoding", label: "std::text_encoding", kind: "library", macro: "__cpp_lib_text_encoding", min: 202306 },
  { id: "hive", label: "std::hive", kind: "library", macro: "__cpp_lib_hive", min: 202502 },
  { id: "execution", label: "std::execution", kind: "library", macro: "__cpp_lib_senders", min: 202406 },
  { id: "linalg", label: "std::linalg", kind: "library", macro: "__cpp_lib_linalg", min: 202311 },
  { id: "hardening", label: "library hardening", kind: "library", macro: "__cpp_lib_hardened_array", min: 202502 },
];

const featureById = new Map(CXX26_FEATURES.map(feature => [feature.id, feature]));

/** Catalog order for a set of feature ids. */
export function sortFeatures(ids: Iterable<string>): string[] {
  const order = new Map(CXX26_FEATURES.map((feature, index) => [feature.id, index]));
  return [...new Set(ids)].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
}

/** "static reflection, contracts" for a list of feature ids. */
export function featureLabels(ids: Iterable<string>): string {
  return sortFeatures(ids).map(id => featureById.get(id)?.label ?? id).join(", ");
}

const PROBE_MARKER = "pi-cpp-lsp-feature:";
const ALTERNATIVE_PREFIX = "PI_CPP_LSP_ALT_";
const PROBE_TIMEOUT_MS = 10_000;
/** clangd builds the probe's preamble (<version>) on first open. */
export const CLANGD_PROBE_TIMEOUT_MS = 15_000;

/** The C++ condition that a feature is present. */
function condition(feature: Feature): string {
  const macro = `(defined(${feature.macro}) && ${feature.macro} >= ${feature.min}L)`;
  return feature.alternative ? `${macro} || (${feature.alternative})` : macro;
}

/**
 * The probe source (KTD1, KTD2). For the compiler it defines a marker for each alternative condition,
 * since a macro dump cannot show `__has_embed`; for clangd (`warnings`) every present feature turns
 * into a `#warning` naming it.
 */
export function probeSource(warnings: boolean): string {
  const lines = ["#if __has_include(<version>)", "#include <version>", "#endif"];
  for (const feature of CXX26_FEATURES) {
    if (warnings) lines.push(`#if ${condition(feature)}`, `#warning "${PROBE_MARKER}${feature.id}"`, "#endif");
    else if (feature.alternative) lines.push(`#if ${feature.alternative}`, `#define ${ALTERNATIVE_PREFIX}${feature.id} 1`, "#endif");
  }
  return `${lines.join("\n")}\n`;
}

/** `#define NAME VALUE` lines of a `-dM -E` dump. */
export function parseMacros(dump: string): Map<string, string> {
  const macros = new Map<string, string>();
  for (const match of dump.matchAll(/^#define ([A-Za-z_]\w*)(?:\s+(.*))?$/gm)) macros.set(match[1]!, (match[2] ?? "").trim());
  return macros;
}

/** The features a macro dump shows, by the catalog's thresholds and alternative markers. */
export function presentFeatures(macros: Map<string, string>): Set<string> {
  const present = new Set<string>();
  for (const feature of CXX26_FEATURES) {
    const value = Number.parseInt(macros.get(feature.macro) ?? "", 10);
    if ((Number.isFinite(value) && value >= feature.min) || macros.has(`${ALTERNATIVE_PREFIX}${feature.id}`)) present.add(feature.id);
  }
  return present;
}

function familyOf(macros: Map<string, string>): Family {
  if (macros.has("__clang__")) return "clang";
  return macros.has("__GNUC__") ? "gcc" : "unknown";
}

/** "g++ 16" from the driver name and the dump's version macro. */
function compilerName(compiler: string, family: Family, macros: Map<string, string>): string {
  const major = family === "clang" ? macros.get("__clang_major__") : family === "gcc" ? macros.get("__GNUC__") : undefined;
  return major ? `${basename(compiler)} ${major}` : basename(compiler);
}

export type CompilerMeasurement =
  | { ok: true; compiler: string; family: Family; available: string[]; needsFlag: Record<string, string> }
  | { ok: false; reason: string };

function firstLines(text: string): string {
  return text.trim().split("\n").slice(0, 3).join("\n");
}

/** Runs `body` with a fresh temporary directory holding `probe.cpp`, removed afterwards. */
async function withProbe<T>(source: string, body: (dir: string, probe: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "pi-cpp-lsp-probe-"));
  const probe = join(dir, "probe.cpp");
  try {
    writeFileSync(probe, source);
    return await body(dir, probe);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Which listed features the entry's compiler supports with the entry's own flags (KTD1), and which
 * ones it supports only behind an extra flag (KTD3).
 */
export async function measureCompiler(entry: CompilationEntry, exec: Exec, signal?: AbortSignal): Promise<CompilerMeasurement> {
  let invocation: ReturnType<typeof probeInvocation>;
  try {
    invocation = probeInvocation(entry);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  const { compiler, args, cwd } = invocation;
  return withProbe(probeSource(false), async (_dir, probe) => {
    const dump = async (extra: string[]) => {
      try {
        const result = await exec(compiler, [...args, ...extra, "-dM", "-E", probe], { cwd, signal, timeout: PROBE_TIMEOUT_MS });
        if (result.code !== 0 || result.killed) return { ok: false as const, reason: firstLines(result.stderr || result.stdout) || `exit ${result.code}` };
        return { ok: true as const, macros: parseMacros(result.stdout) };
      } catch (error) {
        return { ok: false as const, reason: (error as Error).message };
      }
    };
    const first = await dump([]);
    if (!first.ok) return { ok: false, reason: `${basename(compiler)} could not run the feature probe: ${first.reason}` };
    const family = familyOf(first.macros);
    const present = presentFeatures(first.macros);
    const needsFlag: Record<string, string> = {};
    const gated = new Map<string, string[]>();
    for (const feature of CXX26_FEATURES) {
      const flag = feature.enable?.[family];
      if (flag && !present.has(feature.id)) gated.set(flag, [...(gated.get(flag) ?? []), feature.id]);
    }
    for (const [flag, ids] of gated) {
      // A failing second probe means the compiler lacks the flag (GCC 15, or GCC 16 below C++26).
      const second = await dump([flag]);
      if (!second.ok) continue;
      const withFlag = presentFeatures(second.macros);
      for (const id of ids) if (withFlag.has(id)) needsFlag[id] = flag;
    }
    return { ok: true, compiler: compilerName(compiler, family, first.macros), family, available: sortFeatures(present), needsFlag };
  });
}

export type ClangdMeasurement = { ok: true; available: string[] } | { ok: false; reason: string };

/** Flags that would silence the probe's `#warning`s or turn them into a different shape. */
function silencesWarnings(arg: string): boolean {
  return arg === "-w" || arg === "-Wno-#warnings" || arg === "-Wno-cpp" || /^-Werror(?:=|$)/.test(arg) || /^-Wno-error(?:=|$)/.test(arg);
}

/**
 * Which listed features clangd supports under the entry's compile command (KTD2): a short-lived
 * clangd with its own temporary compilation database opens the probe, and every present feature
 * comes back as a `#warning`.
 */
export async function measureClangd(entry: CompilationEntry, options: ClangdOptions = {}, timeoutMs = CLANGD_PROBE_TIMEOUT_MS): Promise<ClangdMeasurement> {
  let invocation: ReturnType<typeof probeInvocation>;
  try {
    invocation = probeInvocation(entry);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  return withProbe(probeSource(true), async (dir, probe) => {
    const args = invocation.args.filter(arg => !silencesWarnings(arg));
    writeFileSync(join(dir, "compile_commands.json"), JSON.stringify([{ directory: invocation.cwd, file: probe, arguments: [invocation.compiler, ...args, probe] }]));
    const connection = new ClangdConnection(dir, dir, options);
    try {
      const { version } = await connection.syncFile(probe);
      const result = await connection.waitForDiagnostics(probe, version, timeoutMs);
      if (result.status === "pending") return { ok: false, reason: `clangd did not answer the feature probe within ${Math.round(timeoutMs / 1000)}s` };
      const present = new Set<string>();
      for (const diagnostic of result.diagnostics) {
        const match = diagnostic.message.match(/pi-cpp-lsp-feature:(\w+)/);
        if (match && featureById.has(match[1]!)) present.add(match[1]!);
      }
      return { ok: true, available: sortFeatures(present) };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    } finally {
      await connection.close().catch(() => {});
    }
  });
}
