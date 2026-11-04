import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { ClangdConnection, type ClangdOptions } from "./clangd.ts";
import { loadCompilationDatabase, probeInvocation, type CompilationEntry } from "./compdb.ts";
import type { Exec } from "./project/configure.ts";
import { oneLine } from "./output.ts";
import { bestRealPath, isWithin, ownersOf, standardRank, type ProjectModel } from "./project/model.ts";

/** A C++11-to-C++26 feature the toolchain can be asked about. */
export interface Feature {
  id: string;
  /** The standard that added it. */
  standard: 11 | 14 | 17 | 20 | 23 | 26;
  /** How the briefing and notes name it. */
  label: string;
  kind: "language" | "library";
  /** The feature-test macro, when the feature has one. */
  macro?: string;
  /** The lowest macro value that counts; the value the standard gives it, or 1 where compilers define 1. */
  min?: number;
  /** A preprocessor condition that also counts as present, e.g. clang's `#embed` without its macro. */
  alternative?: string;
  /** The flag that enables the feature, per compiler family. */
  enable?: Partial<Record<Family, string>>;
}

export type Family = "gcc" | "clang" | "unknown";

/** The standards the catalog covers, oldest first. */
export const STANDARDS: readonly Feature["standard"][] = [11, 14, 17, 20, 23, 26];

const REFLECTION_FLAGS = { gcc: "-freflection" };
// GCC offers modules only with -fmodules, and defines __cpp_modules as 201810, clang as 1.
const MODULE_FLAGS = { gcc: "-fmodules" };

type Entry = Omit<Feature, "standard">;
const language = (id: string, label: string, macro: string | undefined, min: number | undefined, extra: Partial<Entry> = {}): Entry => ({ id, label, kind: "language", macro, min, ...extra });
const library = (id: string, label: string, macro: string, min: number, extra: Partial<Entry> = {}): Entry => ({ id, label, kind: "library", macro, min, ...extra });
const of = (standard: Feature["standard"], entries: Entry[]): Feature[] => entries.map(entry => ({ standard, ...entry }));

// Clang leaves __cpp_nontype_template_args at its C++17 value although it accepts class-type
// template arguments, so that feature is not listed: it would make every GCC target look ahead.
export const FEATURES: readonly Feature[] = [
  // C++11 library additions predate the library feature-test macros, so C++11 lists language features only.
  ...of(11, [
    language("rvalue_references", "rvalue references", "__cpp_rvalue_references", 200610),
    language("lambdas", "lambdas", "__cpp_lambdas", 200907),
    language("constexpr", "constexpr", "__cpp_constexpr", 200704),
    language("variadic_templates", "variadic templates", "__cpp_variadic_templates", 200704),
    language("static_assert", "static_assert", "__cpp_static_assert", 200410),
    language("decltype", "decltype", "__cpp_decltype", 200707),
    language("alias_templates", "alias templates", "__cpp_alias_templates", 200704),
    language("range_based_for", "range-based for", "__cpp_range_based_for", 200907),
    language("initializer_lists", "initializer lists", "__cpp_initializer_lists", 200806),
    language("delegating_constructors", "delegating constructors", "__cpp_delegating_constructors", 200604),
    language("inheriting_constructors", "inheriting constructors", "__cpp_inheriting_constructors", 200802),
    language("nsdmi", "default member initializers", "__cpp_nsdmi", 200809),
    language("raw_strings", "raw string literals", "__cpp_raw_strings", 200710),
    language("unicode_literals", "unicode string literals", "__cpp_unicode_literals", 200710),
    language("user_defined_literals", "user-defined literals", "__cpp_user_defined_literals", 200809),
    language("attributes", "attributes", "__cpp_attributes", 200809),
    language("ref_qualifiers", "ref-qualified member functions", "__cpp_ref_qualifiers", 200710),
    language("threadsafe_static_init", "thread-safe static initialization", "__cpp_threadsafe_static_init", 200806),
  ]),
  ...of(14, [
    language("generic_lambdas", "generic lambdas", "__cpp_generic_lambdas", 201304),
    language("init_captures", "init captures", "__cpp_init_captures", 201304),
    language("relaxed_constexpr", "relaxed constexpr", "__cpp_constexpr", 201304),
    language("return_type_deduction", "return type deduction", "__cpp_return_type_deduction", 201304),
    language("decltype_auto", "decltype(auto)", "__cpp_decltype_auto", 201304),
    language("binary_literals", "binary literals", "__cpp_binary_literals", 201304),
    language("variable_templates", "variable templates", "__cpp_variable_templates", 201304),
    language("aggregate_nsdmi", "aggregates with default member initializers", "__cpp_aggregate_nsdmi", 201304),
    language("sized_deallocation", "sized deallocation", "__cpp_sized_deallocation", 201309),
    library("make_unique", "std::make_unique", "__cpp_lib_make_unique", 201304),
    library("integer_sequence", "std::integer_sequence", "__cpp_lib_integer_sequence", 201304),
    library("exchange", "std::exchange", "__cpp_lib_exchange_function", 201304),
    library("shared_timed_mutex", "std::shared_timed_mutex", "__cpp_lib_shared_timed_mutex", 201402),
    library("chrono_udls", "chrono literals", "__cpp_lib_chrono_udls", 201304),
    library("string_udls", "string literals (\"s\"s)", "__cpp_lib_string_udls", 201304),
    library("transparent_operators", "transparent comparators", "__cpp_lib_transparent_operators", 201210),
    library("quoted", "std::quoted", "__cpp_lib_quoted_string_io", 201304),
  ]),
  ...of(17, [
    language("structured_bindings", "structured bindings", "__cpp_structured_bindings", 201606),
    language("if_constexpr", "if constexpr", "__cpp_if_constexpr", 201606),
    language("inline_variables", "inline variables", "__cpp_inline_variables", 201606),
    language("fold_expressions", "fold expressions", "__cpp_fold_expressions", 201603),
    language("deduction_guides", "class template argument deduction", "__cpp_deduction_guides", 201703),
    language("auto_template_parameters", "auto template parameters", "__cpp_nontype_template_parameter_auto", 201606),
    language("guaranteed_copy_elision", "guaranteed copy elision", "__cpp_guaranteed_copy_elision", 201606),
    language("aligned_new", "aligned new", "__cpp_aligned_new", 201606),
    language("noexcept_function_type", "noexcept in the type system", "__cpp_noexcept_function_type", 201510),
    language("hex_float", "hexadecimal float literals", "__cpp_hex_float", 201603),
    language("constexpr_lambda", "constexpr lambdas", "__cpp_constexpr", 201603),
    language("capture_star_this", "capturing *this", "__cpp_capture_star_this", 201603),
    language("aggregate_bases", "aggregates with base classes", "__cpp_aggregate_bases", 201603),
    language("variadic_using", "variadic using declarations", "__cpp_variadic_using", 201611),
    library("optional", "std::optional", "__cpp_lib_optional", 201606),
    library("variant", "std::variant", "__cpp_lib_variant", 201606),
    library("any", "std::any", "__cpp_lib_any", 201606),
    library("string_view", "std::string_view", "__cpp_lib_string_view", 201606),
    library("filesystem", "std::filesystem", "__cpp_lib_filesystem", 201703),
    library("apply", "std::apply", "__cpp_lib_apply", 201603),
    library("invoke", "std::invoke", "__cpp_lib_invoke", 201411),
    library("byte", "std::byte", "__cpp_lib_byte", 201603),
    library("to_chars", "std::to_chars", "__cpp_lib_to_chars", 201611),
    library("shared_mutex", "std::shared_mutex", "__cpp_lib_shared_mutex", 201505),
    library("scoped_lock", "std::scoped_lock", "__cpp_lib_scoped_lock", 201703),
    library("gcd_lcm", "std::gcd and std::lcm", "__cpp_lib_gcd_lcm", 201606),
    library("parallel_algorithm", "parallel algorithms", "__cpp_lib_parallel_algorithm", 201603),
  ]),
  ...of(20, [
    language("concepts", "concepts", "__cpp_concepts", 201907),
    language("coroutines", "coroutines", "__cpp_impl_coroutine", 201902),
    language("modules", "modules", "__cpp_modules", 1, { enable: MODULE_FLAGS }),
    language("three_way_comparison", "three-way comparison (<=>)", "__cpp_impl_three_way_comparison", 201907),
    language("consteval", "consteval", "__cpp_consteval", 201811),
    language("constinit", "constinit", "__cpp_constinit", 201907),
    language("designated_initializers", "designated initializers", "__cpp_designated_initializers", 201707),
    language("char8_t", "char8_t", "__cpp_char8_t", 201811),
    language("using_enum", "using enum", "__cpp_using_enum", 201907),
    language("aggregate_paren_init", "parenthesized aggregate initialization", "__cpp_aggregate_paren_init", 201902),
    language("conditional_explicit", "conditional explicit", "__cpp_conditional_explicit", 201806),
    language("constexpr_dynamic_alloc", "constexpr dynamic allocation", "__cpp_constexpr_dynamic_alloc", 201907),
    library("ranges", "ranges", "__cpp_lib_ranges", 201911),
    library("format", "std::format", "__cpp_lib_format", 201907),
    library("span", "std::span", "__cpp_lib_span", 202002),
    library("source_location", "std::source_location", "__cpp_lib_source_location", 201907),
    library("jthread", "std::jthread", "__cpp_lib_jthread", 201911),
    library("bit_cast", "std::bit_cast", "__cpp_lib_bit_cast", 201806),
    library("numbers", "<numbers>", "__cpp_lib_math_constants", 201907),
    library("semaphore", "<semaphore>", "__cpp_lib_semaphore", 201907),
  ]),
  ...of(23, [
    language("explicit_this", "deducing this", "__cpp_explicit_this_parameter", 202110),
    language("if_consteval", "if consteval", "__cpp_if_consteval", 202106),
    language("multidimensional_subscript", "multidimensional subscript", "__cpp_multidimensional_subscript", 202110),
    language("static_call_operator", "static operator()", "__cpp_static_call_operator", 202207),
    language("auto_cast", "auto(x)", "__cpp_auto_cast", 202110),
    language("size_t_suffix", "the uz literal suffix", "__cpp_size_t_suffix", 202011),
    language("named_character_escapes", "named character escapes", "__cpp_named_character_escapes", 202207),
    language("implicit_move", "simpler implicit move", "__cpp_implicit_move", 202207),
    language("assume", "[[assume]]", undefined, undefined, { alternative: "defined(__has_cpp_attribute) && __has_cpp_attribute(assume) >= 202207L" }),
    language("float16", "std::float16_t", "__STDCPP_FLOAT16_T__", 1),
    library("expected", "std::expected", "__cpp_lib_expected", 202211),
    library("print", "std::print", "__cpp_lib_print", 202207),
    library("mdspan", "std::mdspan", "__cpp_lib_mdspan", 202207),
    library("generator", "std::generator", "__cpp_lib_generator", 202207),
    library("flat_map", "std::flat_map", "__cpp_lib_flat_map", 202207),
    library("stacktrace", "std::stacktrace", "__cpp_lib_stacktrace", 202011),
    library("import_std", "import std", "__cpp_lib_modules", 202207, { enable: MODULE_FLAGS }),
    library("ranges_to", "ranges::to", "__cpp_lib_ranges_to_container", 202202),
    library("unreachable", "std::unreachable", "__cpp_lib_unreachable", 202202),
    library("move_only_function", "std::move_only_function", "__cpp_lib_move_only_function", 202110),
    library("byteswap", "std::byteswap", "__cpp_lib_byteswap", 202110),
    library("string_contains", "string::contains", "__cpp_lib_string_contains", 202011),
  ]),
  ...of(26, [
    language("reflection", "static reflection", "__cpp_impl_reflection", 202506, { enable: REFLECTION_FLAGS }),
    language("contracts", "contracts", "__cpp_contracts", 202502),
    language("pack_indexing", "pack indexing", "__cpp_pack_indexing", 202311),
    language("embed", "#embed", "__cpp_pp_embed", 202502, { alternative: "defined(__has_embed)" }),
    language("expansion_statements", "expansion statements", "__cpp_expansion_statements", 202506),
    language("constexpr_exceptions", "constexpr exceptions", "__cpp_constexpr_exceptions", 202411),
    language("placeholder_variables", "the _ placeholder", "__cpp_placeholder_variables", 202306),
    language("deleted_function", "= delete(\"reason\")", "__cpp_deleted_function", 202403),
    language("structured_binding_packs", "structured binding packs", "__cpp_structured_bindings", 202411),
    language("variadic_friend", "variadic friends", "__cpp_variadic_friend", 202403),
    language("trivial_relocatability", "trivial relocatability", "__cpp_trivial_relocatability", 202502),
    library("meta", "<meta>", "__cpp_lib_reflection", 202506, { enable: REFLECTION_FLAGS }),
    library("inplace_vector", "std::inplace_vector", "__cpp_lib_inplace_vector", 202406),
    library("saturation_arithmetic", "saturation arithmetic", "__cpp_lib_saturation_arithmetic", 202311),
    library("text_encoding", "std::text_encoding", "__cpp_lib_text_encoding", 202306),
    library("hive", "std::hive", "__cpp_lib_hive", 202502),
    library("execution", "std::execution", "__cpp_lib_senders", 202406),
    library("linalg", "std::linalg", "__cpp_lib_linalg", 202311),
    library("hardening", "library hardening", "__cpp_lib_hardened_array", 202502),
  ]),
];

const featureById = new Map(FEATURES.map(feature => [feature.id, feature]));

/** Catalog order for a set of feature ids. */
export function sortFeatures(ids: Iterable<string>): string[] {
  const order = new Map(FEATURES.map((feature, index) => [feature.id, index]));
  return [...new Set(ids)].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
}

/** "static reflection, contracts" for a list of feature ids. */
export function featureLabels(ids: Iterable<string>): string {
  return sortFeatures(ids).map(id => featureById.get(id)?.label ?? id).join(", ");
}

const PROBE_MARKER = "pi-cpp-lsp-feature:";
const PROBE_END = "end";
const MARKER_PATTERN = new RegExp(`${PROBE_MARKER}(\\w+)`);
const ALTERNATIVE_PREFIX = "PI_CPP_LSP_ALT_";
const PROBE_TIMEOUT_MS = 10_000;
/** clangd builds the probe's preamble (<version>) on first open. */
export const CLANGD_PROBE_TIMEOUT_MS = 15_000;

/** The C++ condition that a feature is present. */
function condition(feature: Feature): string {
  const parts: string[] = [];
  if (feature.macro) parts.push(`(defined(${feature.macro}) && ${feature.macro} >= ${feature.min ?? 1}L)`);
  if (feature.alternative) parts.push(`(${feature.alternative})`);
  return parts.join(" || ");
}

/**
 * The probe source. For the compiler it defines a marker for each alternative condition,
 * since a macro dump cannot show `__has_embed`; for clangd (`warnings`) every present feature turns
 * into a `#warning` naming it.
 */
export function probeSource(warnings: boolean): string {
  const lines = ["#if __has_include(<version>)", "#include <version>", "#endif"];
  for (const feature of FEATURES) {
    if (warnings) lines.push(`#if ${condition(feature)}`, `#warning "${PROBE_MARKER}${feature.id}"`, "#endif");
    else if (feature.alternative) lines.push(`#if ${feature.alternative}`, `#define ${ALTERNATIVE_PREFIX}${feature.id} 1`, "#endif");
  }
  // Always last: without it, a probe that was cut short or silenced would read as missing features.
  if (warnings) lines.push(`#warning "${PROBE_MARKER}${PROBE_END}"`);
  return `${lines.join("\n")}\n`;
}

/** `#define NAME VALUE` lines of a `-dM -E` dump. */
export function parseMacros(dump: string): Map<string, string> {
  const macros = new Map<string, string>();
  for (const match of dump.matchAll(/^#define ([A-Za-z_]\w*)(?:[ \t]+(.*))?$/gm)) macros.set(match[1]!, (match[2] ?? "").trim());
  return macros;
}

/** The features a macro dump shows, by the catalog's thresholds and alternative markers. */
export function presentFeatures(macros: Map<string, string>): Set<string> {
  const present = new Set<string>();
  for (const feature of FEATURES) {
    const value = feature.macro ? Number.parseInt(macros.get(feature.macro) ?? "", 10) : Number.NaN;
    if ((Number.isFinite(value) && value >= (feature.min ?? 1)) || macros.has(`${ALTERNATIVE_PREFIX}${feature.id}`)) present.add(feature.id);
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

/** The entry's probe invocation, or why it cannot run (a wrapper or an unsupported flag). */
function probeFor(entry: CompilationEntry): ReturnType<typeof probeInvocation> | { reason: string } {
  try {
    return probeInvocation(entry);
  } catch (error) {
    return { reason: (error as Error).message };
  }
}

/**
 * Which listed features the entry's compiler supports with the entry's own flags, and which
 * ones it supports only behind an extra flag.
 */
export async function measureCompiler(entry: CompilationEntry, exec: Exec, signal?: AbortSignal): Promise<CompilerMeasurement> {
  const invocation = probeFor(entry);
  if ("reason" in invocation) return { ok: false, reason: invocation.reason };
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
    for (const feature of FEATURES) {
      const flag = feature.enable?.[family];
      if (flag && !present.has(feature.id)) gated.set(flag, [...(gated.get(flag) ?? []), feature.id]);
    }
    await Promise.all([...gated].map(async ([flag, ids]) => {
      // A failing second probe means the compiler lacks the flag, as GCC 15 lacks -freflection.
      const second = await dump([flag]);
      if (!second.ok) return;
      const withFlag = presentFeatures(second.macros);
      for (const id of ids) if (withFlag.has(id)) needsFlag[id] = flag;
    }));
    return { ok: true, compiler: compilerName(compiler, family, first.macros), family, available: sortFeatures(present), needsFlag };
  });
}

export type ClangdMeasurement = { ok: true; available: string[] } | { ok: false; reason: string };

/** Flags that would silence the probe's `#warning`s or turn them into a different shape. */
function silencesWarnings(arg: string): boolean {
  return arg === "-w" || arg === "-Wno-#warnings" || arg === "-Wno-cpp" || arg === "-Wno-everything" || arg === "-pedantic-errors"
    || /^-Werror(?:=|$)/.test(arg) || /^-Wno-error(?:=|$)/.test(arg) || /^-f(?:error-limit|max-errors)=/.test(arg);
}

/**
 * Which listed features clangd supports under the entry's compile command: a short-lived
 * clangd with its own temporary compilation database opens the probe, and every present feature
 * comes back as a `#warning`.
 */
export async function measureClangd(entry: CompilationEntry, options: ClangdOptions = {}, timeoutMs = CLANGD_PROBE_TIMEOUT_MS): Promise<ClangdMeasurement> {
  const invocation = probeFor(entry);
  if ("reason" in invocation) return { ok: false, reason: invocation.reason };
  return withProbe(probeSource(true), async (dir, probe) => {
    // Before C++23 a #warning is an extension, so pedantic settings can turn the markers into errors;
    // no error limit may then stop clangd before the last one.
    const args = [...invocation.args.filter(arg => !silencesWarnings(arg)), "-ferror-limit=0"];
    writeFileSync(join(dir, "compile_commands.json"), JSON.stringify([{ directory: invocation.cwd, file: probe, arguments: [invocation.compiler, ...args, probe] }]));
    const connection = new ClangdConnection(dir, dir, options);
    try {
      const { version } = await connection.syncFile(probe);
      const result = await connection.waitForDiagnostics(probe, version, timeoutMs);
      if (result.status === "pending") return { ok: false, reason: `clangd did not answer the feature probe within ${Math.round(timeoutMs / 1000)}s` };
      const present = new Set<string>();
      let complete = false;
      for (const diagnostic of result.diagnostics) {
        const match = diagnostic.message.match(MARKER_PATTERN);
        if (match?.[1] === PROBE_END) complete = true;
        else if (match && featureById.has(match[1]!)) present.add(match[1]!);
      }
      // Something in clangd's configuration hid or stopped the markers; that is no evidence of missing features.
      if (!complete) return { ok: false, reason: "clangd's feature probe was cut short or its warnings were suppressed" };
      return { ok: true, available: sortFeatures(present) };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    } finally {
      await connection.close().catch(() => {});
    }
  });
}

// ---------------------------------------------------------------------------
// Per-session service

/** The feature profile of one target on C++11 or newer. */
export interface TargetProfile {
  target: string;
  /** The catalog standard the target is measured for: features of this standard and older ones count. */
  standard: Feature["standard"];
  /** "g++ 16"; absent when the compiler could not be measured. */
  compiler?: string;
  family?: Family;
  /** Features every compile group of the target can use. */
  available: string[];
  /** Features available only with an extra flag the target does not pass, by flag. */
  needsFlag: Record<string, string>;
  /** Available features clangd does not support; empty when clangd could not be measured. */
  clangdLacks: string[];
  /** The build compiler supports a listed feature clangd lacks. */
  gap: boolean;
  /** Why the compiler, or clangd, could not be measured. */
  error?: string;
  clangdError?: string;
  /** A compile command of the target, borrowed for headers. */
  entry?: CompilationEntry;
}

export interface ToolchainServiceOptions {
  /** Runs the compiler probes; pass pi.exec. */
  exec: Exec;
  /** How to start clangd for its probe; defaults to `clangd` on PATH. */
  clangd?: ClangdOptions;
  /** Bound for one clangd probe. */
  clangdTimeoutMs?: number;
}

/** The parts of the project service the toolchain service follows. */
export interface ToolchainProject {
  readonly model?: ProjectModel;
  onModelChange(listener: (change: { model: ProjectModel; compileDatabase: string; compileDatabaseChanged: boolean }) => void): () => void;
}

/** Distinct compile command groups measured at once. */
const MEASURE_CONCURRENCY = 2;
/** Files that are included rather than compiled on their own; a check compiles them with a borrowed command. */
export const HEADER_EXTENSIONS: ReadonlySet<string> = new Set([".h", ".hh", ".hpp", ".hxx", ".h++", ".ipp", ".tpp", ".inl"]);

/**
 * The catalog standard a normalized target standard ("20", "23", "26", "98") is measured for:
 * the newest catalog standard not newer than it, or undefined before C++11.
 */
export function catalogStandard(standard: string | undefined): Feature["standard"] | undefined {
  if (standard === undefined) return undefined;
  const year = standardRank(standard);
  if (!Number.isFinite(year)) return undefined;
  return [...STANDARDS].reverse().find(candidate => year >= 2000 + candidate);
}

/** The ids of the catalog features up to `standard`. */
function featuresUpTo(standard: Feature["standard"]): Set<string> {
  return new Set(FEATURES.filter(feature => feature.standard <= standard).map(feature => feature.id));
}

interface GroupResult {
  entry: CompilationEntry;
  compiler: CompilerMeasurement;
  clangd?: ClangdMeasurement;
}

/** Runs `body` over `items` with at most `limit` at a time; results keep the items' order. */
export async function mapLimited<T, R>(items: T[], limit: number, body: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await body(items[index]!);
    }
  }));
  return results;
}

const intersect = (sets: string[][]) => sets.length === 0 ? [] : sets.reduce((acc, set) => acc.filter(id => set.includes(id)));

/** The profile of a target whose compiler could not be measured. */
function unmeasuredProfile(target: string, standard: Feature["standard"], reason: string): TargetProfile {
  return { target, standard, available: [], needsFlag: {}, clangdLacks: [], gap: false, error: reason };
}

function targetProfile(target: string, standard: Feature["standard"], groups: GroupResult[]): TargetProfile {
  const listed = featuresUpTo(standard);
  const measured = groups.filter((group): group is GroupResult & { compiler: Extract<CompilerMeasurement, { ok: true }> } => group.compiler.ok);
  if (measured.length === 0) {
    const reason = groups.map(group => !group.compiler.ok ? group.compiler.reason : "").find(Boolean) ?? "no C++ source has a compilation database entry";
    return unmeasuredProfile(target, standard, reason);
  }
  const available = intersect(measured.map(group => group.compiler.available)).filter(id => listed.has(id));
  const needsFlag: Record<string, string> = {};
  for (const group of measured) {
    for (const [id, flag] of Object.entries(group.compiler.needsFlag)) if (listed.has(id) && !available.includes(id)) needsFlag[id] = flag;
  }
  const clangd = measured.map(group => group.clangd);
  const clangdFailure = clangd.find(result => !result?.ok);
  const profile: TargetProfile = { target, standard, compiler: measured[0]!.compiler.compiler, family: measured[0]!.compiler.family, available, needsFlag, clangdLacks: [], gap: false, entry: measured[0]!.entry };
  if (clangdFailure) {
    profile.clangdError = clangdFailure.ok === false ? clangdFailure.reason : "clangd was not measured";
  } else {
    const clangdAvailable = intersect(clangd.map(result => (result as Extract<ClangdMeasurement, { ok: true }>).available));
    profile.clangdLacks = available.filter(id => !clangdAvailable.includes(id));
    profile.gap = profile.clangdLacks.length > 0;
  }
  return profile;
}

/**
 * Measures the feature profile of every target on C++11 or newer in the session's project, again
 * whenever the compilation database changes, and answers which gap profile, if any, a file belongs
 * to. Results live in memory only.
 */
export class ToolchainService {
  private readonly options: ToolchainServiceOptions;
  private project?: ToolchainProject;
  private unsubscribe?: () => void;
  private generation = 0;
  private controller?: AbortController;
  private current?: { model: ProjectModel; profiles: TargetProfile[] };
  private running?: Promise<void>;

  constructor(options: ToolchainServiceOptions) {
    this.options = options;
  }

  /** Follows `project`; a different project drops the old results. */
  attach(project: ToolchainProject | undefined): void {
    if (project === this.project) return;
    this.detach();
    this.project = project;
    if (!project) return;
    this.unsubscribe = project.onModelChange(change => {
      if (change.compileDatabaseChanged || !this.current) this.start(change.model, change.compileDatabase);
    });
    if (project.model) this.start(project.model, join(project.model.buildDir, "compile_commands.json"));
  }

  /** Whether a measurement is running. */
  get measuring(): boolean {
    return this.running !== undefined;
  }

  /** Profiles of the measured targets from the last finished measurement; undefined before the first one. */
  get profiles(): readonly TargetProfile[] | undefined {
    return this.current?.profiles;
  }

  /** The profiles with a gap. */
  get gapProfiles(): TargetProfile[] {
    return (this.current?.profiles ?? []).filter(profile => profile.gap);
  }

  /** Resolves once no measurement is running, or after `timeoutMs`. */
  async settled(timeoutMs = Infinity): Promise<void> {
    while (this.running) {
      const running = this.running;
      if (!Number.isFinite(timeoutMs)) { await running; continue; }
      let timer: NodeJS.Timeout | undefined;
      const expired = new Promise<"expired">(done => { timer = setTimeout(() => done("expired"), Math.max(0, timeoutMs)); });
      const outcome = await Promise.race([running.then(() => "done" as const), expired]);
      clearTimeout(timer);
      if (outcome === "expired") return;
    }
  }

  /**
   * The gap profile `file` belongs to: the first owning measured target with a gap, or for a
   * header no target lists, the first gap target whose include directories contain it.
   */
  gapProfileFor(file: string): TargetProfile | undefined {
    const current = this.current;
    if (!current) return undefined;
    const gaps = new Map(current.profiles.filter(profile => profile.gap).map(profile => [profile.target, profile]));
    if (gaps.size === 0) return undefined;
    const path = bestRealPath(file);
    const owners = ownersOf(current.model, path).filter(target => target.isProjectTarget);
    if (owners.length > 0) return owners.map(target => gaps.get(target.name)).find(Boolean);
    if (!HEADER_EXTENSIONS.has(extname(path).toLowerCase())) return undefined;
    for (const target of current.model.targets) {
      const profile = gaps.get(target.name);
      if (profile && target.includeDirs.some(dir => isWithin(dir, path))) return profile;
    }
    return undefined;
  }

  private start(model: ProjectModel, compileDatabase: string): void {
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const run = this.measure(model, compileDatabase, controller.signal).then(profiles => {
      if (generation === this.generation && profiles) this.current = { model, profiles };
    }, () => {});
    this.running = run;
    void run.finally(() => { if (this.running === run) this.running = undefined; });
  }

  private async measure(model: ProjectModel, compileDatabase: string, signal: AbortSignal): Promise<TargetProfile[] | undefined> {
    const targets = model.targets.filter(target => target.isProjectTarget && catalogStandard(target.cxxStandard) !== undefined);
    if (targets.length === 0) return [];
    let entries: Map<string, CompilationEntry>;
    try {
      entries = loadCompilationDatabase(compileDatabase);
    } catch (error) {
      const reason = (error as Error).message;
      return targets.map(target => unmeasuredProfile(target.name, catalogStandard(target.cxxStandard)!, reason));
    }
    // One measurement per distinct compiler and flags.
    const groups = new Map<string, CompilationEntry>();
    const targetGroups = new Map<string, string[]>();
    // Sources of one target usually share a command that differs only in the source path, so the
    // probe invocation (a realpath per argument) is worked out once per such command.
    const keyByCommand = new Map<string, string>();
    for (const target of targets) {
      const keys = new Set<string>();
      for (const source of target.sources) {
        if (source.language !== "CXX" || source.isGenerated) continue;
        const entry = entries.get(source.path);
        if (!entry) continue;
        const command = JSON.stringify([entry.directory, entry.argv.map(arg => resolve(entry.directory, arg) === entry.file ? "" : arg)]);
        let key = keyByCommand.get(command);
        if (key === undefined) {
          const invocation = probeFor(entry);
          key = "reason" in invocation ? JSON.stringify(["error", invocation.reason]) : JSON.stringify([invocation.compiler, invocation.args, invocation.cwd]);
          keyByCommand.set(command, key);
        }
        keys.add(key);
        if (!groups.has(key)) groups.set(key, entry);
      }
      targetGroups.set(target.name, [...keys]);
    }
    const keys = [...groups.keys()];
    const results = await mapLimited(keys, MEASURE_CONCURRENCY, async key => {
      const entry = groups.get(key)!;
      const compiler = await measureCompiler(entry, this.options.exec, signal);
      const clangd = compiler.ok && !signal.aborted ? await measureClangd(entry, this.options.clangd, this.options.clangdTimeoutMs) : undefined;
      return { entry, compiler, clangd } satisfies GroupResult;
    });
    if (signal.aborted) return undefined;
    const byKey = new Map(keys.map((key, index) => [key, results[index]!]));
    return targets.map(target => targetProfile(target.name, catalogStandard(target.cxxStandard)!, (targetGroups.get(target.name) ?? []).map(key => byKey.get(key)!)));
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.project = undefined;
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    this.current = undefined;
  }

  /** Stops following the project. */
  close(): void {
    this.detach();
  }
}

// ---------------------------------------------------------------------------
// /cpp-setup

const SETUP_STANDARD = "c++26";


/**
 * /cpp-setup lines comparing the default C++ compiler (`$CXX`, else `c++`) under `-std=c++26` with
 * clangd under the same command: per standard, the features both, only one or neither support.
 */
export async function setupFeatureLines(exec: Exec, options: Pick<ToolchainServiceOptions, "clangd" | "clangdTimeoutMs"> = {}): Promise<string[]> {
  const cxx = process.env.CXX || "c++";
  const entry: CompilationEntry = { file: join(tmpdir(), "pi-cpp-lsp-setup.cpp"), directory: tmpdir(), argv: [cxx, `-std=${SETUP_STANDARD}`] };
  const lines: string[] = [];
  // pi.exec reports a missing program only as a failed run, so look it up first.
  const found = (await exec("sh", ["-c", 'command -v "$1"', "sh", cxx], { timeout: 5000 }).catch(() => undefined))?.code === 0;
  const [compiler, clangd] = await Promise.all([
    found ? measureCompiler(entry, exec) : undefined,
    measureClangd(entry, options.clangd, options.clangdTimeoutMs),
  ]);
  if (!found) lines.push(`✗ C++ compiler: ${cxx} was not found on PATH; set CXX to measure another compiler`);
  else if (!compiler!.ok) lines.push(`✗ C++ compiler: ${cxx} could not be measured: ${oneLine(compiler!.reason)}`);
  else lines.push(`✓ C++ compiler: ${compiler!.compiler} (${compiler!.family}), measured with -std=${SETUP_STANDARD}`);
  if (!clangd.ok) lines.push(`✗ clangd feature probe: ${oneLine(clangd.reason)}`);

  const ofCompiler = compiler?.ok ? new Set(compiler.available) : undefined;
  const ofClangd = clangd.ok ? new Set(clangd.available) : undefined;
  if (!ofCompiler && !ofClangd) return lines;
  const needsFlag = compiler?.ok ? compiler.needsFlag : {};
  lines.push(`  C++ features with -std=${SETUP_STANDARD}, ${ofCompiler && ofClangd ? "compiler vs clangd" : ofCompiler ? "compiler" : "clangd"}:`);
  for (const standard of STANDARDS) {
    const ids = FEATURES.filter(feature => feature.standard === standard).map(feature => feature.id);
    const parts: [string, string[]][] = [];
    if (ofCompiler && ofClangd) {
      const both = ids.filter(id => ofCompiler.has(id) && ofClangd.has(id));
      if (both.length === ids.length) {
        lines.push(`  C++${standard}: all ${ids.length} in both`);
        continue;
      }
      parts.push(["both", both], ["compiler only", ids.filter(id => ofCompiler.has(id) && !ofClangd.has(id))], ["clangd only", ids.filter(id => !ofCompiler.has(id) && ofClangd.has(id))]);
    } else {
      const side = (ofCompiler ?? ofClangd)!;
      parts.push([ofCompiler ? "compiler" : "clangd", ids.filter(id => side.has(id))]);
    }
    const flags = new Map<string, string[]>();
    for (const id of ids) if (needsFlag[id]) flags.set(needsFlag[id]!, [...(flags.get(needsFlag[id]!) ?? []), id]);
    for (const [flag, flagged] of flags) parts.push([`${ofClangd ? "compiler needs" : "needs"} \`${flag}\``, flagged]);
    const missing = ids.filter(id => !ofCompiler?.has(id) && !ofClangd?.has(id) && !needsFlag[id]);
    parts.push([ofCompiler && ofClangd ? "neither" : "not supported", missing]);
    lines.push(`  C++${standard}: ${parts.filter(([, list]) => list.length > 0).map(([name, list]) => `${name}: ${featureLabels(list)}`).join("; ")}`);
  }
  return lines;
}
