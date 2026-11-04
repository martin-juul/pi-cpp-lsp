import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

export interface CompileOptions {
  file: string;
  build_dir?: string;
  compiler?: string;
  standard?: string;
}
export interface CompileInvocation {
  compiler: string;
  args: string[];
  cwd: string;
  file: string;
  database?: string;
}

/** Parse the POSIX quoting used by compilation databases, without invoking a shell. */
export function splitCommand(command: string): string[] {
  const words: string[] = [];
  let word = "", quote = "", started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = "";
      else word += c;
    } else if (c === "\\") {
      const next = command[++i];
      if (next === undefined) throw new Error("Unterminated escape in compilation command");
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) word += "\\";
      if (next !== "\n") word += next;
      started = true;
    } else if (quote === '"') {
      if (c === '"') quote = "";
      else if (c === "$" || c === "`") throw new Error("Shell expansion is unsupported in compilation commands; use an arguments array");
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === "\n" && started) {
      throw new Error("Shell command separators are unsupported in compilation commands");
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      if (/[;&|<>`$*?\n]/.test(c)) throw new Error("Shell operators and expansions are unsupported in compilation commands; use an arguments array");
      word += c;
      started = true;
    }
  }
  if (quote) throw new Error("Unterminated quote in compilation command");
  if (started) words.push(word);
  return words;
}

function canonical(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

export function findCompilationDatabase(cwd: string, file: string, buildDir?: string): string | undefined {
  if (buildDir !== undefined) {
    const candidate = join(resolve(cwd, buildDir), "compile_commands.json");
    if (!existsSync(candidate)) throw new Error(`Compilation database not found: ${candidate}`);
    return candidate;
  }
  // Prefer the session project, then walk the source's parent directories.
  const roots = new Set<string>([resolve(cwd)]);
  for (let dir = dirname(resolve(cwd, file)); ; dir = dirname(dir)) {
    roots.add(dir);
    if (dirname(dir) === dir) break;
  }
  for (const root of roots) {
    for (const candidate of [join(root, "compile_commands.json"), join(root, "build", "compile_commands.json")]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function checkCompiler(compiler: string): void {
  if (!/^(?:clang(?:\+\+)?|gcc|g\+\+|cc|c\+\+)(?:-\d+(?:\.\d+)*)?$/.test(basename(compiler)) &&
      !/^[\w.+-]+-(?:gcc|g\+\+|clang(?:\+\+)?)(?:-\d+(?:\.\d+)*)?$/.test(basename(compiler))) {
    throw new Error(`Unsupported compiler '${compiler}': use a GCC/Clang driver directly (wrappers and MSVC commands are unsupported)`);
  }
}

/**
 * CMake's C++20 module-dependency scanning (CMake 3.28+ with Ninja) adds these to every entry of a
 * C++20-or-newer target: GCC gets the -fmodules-ts/-fmodule-mapper/-fdeps-* flags and clang a
 * `@<object>.modmap` response file. They are dropped; a source that really imports modules still fails.
 */
function isModuleScanArgument(arg: string): boolean {
  return arg === "-fmodules-ts" || /^-fmodule-mapper=/.test(arg) || /^-fdeps-(?:format|file|target)=/.test(arg) || (arg.startsWith("@") && arg.endsWith(".modmap"));
}

export function syntaxArguments(args: string[], standard?: string): string[] {
  const result: string[] = [];
  const takesOutput = new Set(["-o", "--output", "-MF", "-MT", "-MQ", "-MJ", "-dependency-file", "--serialize-diagnostics", "-serialize-diagnostics"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (isModuleScanArgument(arg)) continue;
    if (arg.startsWith("@")) throw new Error("Response files are unsupported for syntax checks; expand them in compile_commands.json");
    if (arg === "--") throw new Error("The compiler '--' delimiter is unsupported for syntax checks");
    if (takesOutput.has(arg)) {
      if (++i >= args.length) throw new Error(`Missing value for compiler flag ${arg}`);
      continue;
    }
    if (/^(?:-o.+|--output=|-M[FTQJ].+|-{1,2}serialize-diagnostics=)/.test(arg)) continue;
    if (["-c", "-S", "-E", "-M", "-MM", "-MD", "-MMD", "-MP", "-MG", "-fsyntax-only", "--coverage", "-ftest-coverage", "-fprofile-arcs", "-gsplit-dwarf"].includes(arg)) continue;
    if (/^-save-temps(?:=|$)/.test(arg)) continue;
    if (/^(?:-Wp,|-Xclang|-Xpreprocessor|-fplugin|-fmodules|-fmodule-|-fprofile|-ftime-trace|-fsave-optimization-record|-foptimization-record|-fdiagnostics-serialization|-fdiagnostics-format=(?:sarif|json)-file|-fdump|-aux-info|-dump|-emit-|--analyze)/.test(arg)) {
      throw new Error(`Unsupported compiler flag for an artifact-free syntax check: ${arg}`);
    }
    if (standard !== undefined && /^-std(?:=|$)/.test(arg)) {
      if (arg === "-std") i++;
      continue;
    }
    result.push(arg);
  }
  if (standard !== undefined) result.push(`-std=${standard}`);
  result.push("-fsyntax-only");
  return result;
}

function readEntries(database: string): any[] {
  let entries: unknown;
  try { entries = JSON.parse(readFileSync(database, "utf8")); }
  catch (err) { throw new Error(`Cannot read compilation database ${database}: ${(err as Error).message}`); }
  if (!Array.isArray(entries)) throw new Error(`Compilation database must contain an array: ${database}`);
  return entries;
}

function isEntry(value: any): boolean {
  return value && typeof value.file === "string" && typeof value.directory === "string";
}

function entryArgv(entry: any): string[] {
  if (entry.arguments !== undefined) {
    if (!Array.isArray(entry.arguments) || entry.arguments.length === 0 || !entry.arguments.every((arg: unknown) => typeof arg === "string")) throw new Error("Compilation entry arguments must be a nonempty string array");
    return entry.arguments;
  }
  if (typeof entry.command === "string") return splitCommand(entry.command);
  throw new Error("Compilation entry requires arguments or command");
}

/** One compilation database entry with its paths resolved. */
export interface CompilationEntry {
  /** Canonical (real) path of the source. */
  file: string;
  /** Absolute working directory of the command. */
  directory: string;
  argv: string[];
}

/** Every usable entry of `database`, keyed by the source's canonical path; the first entry for a file wins. */
export function loadCompilationDatabase(database: string): Map<string, CompilationEntry> {
  const result = new Map<string, CompilationEntry>();
  for (const value of readEntries(database)) {
    if (!isEntry(value)) continue;
    let argv: string[];
    try { argv = entryArgv(value); } catch { continue; }
    const directory = resolve(dirname(database), value.directory);
    const file = canonical(resolve(directory, value.file));
    if (!result.has(file)) result.set(file, { file, directory, argv });
  }
  return result;
}

/** The compiler driver of an entry, resolved against its directory when it is a relative path. */
function entryCompiler(compiler: string, directory: string): string {
  return compiler.includes("/") && !isAbsolute(compiler) ? resolve(directory, compiler) : compiler;
}

/**
 * The entry's compiler and flags without the source file, output and dependency-file flags, for
 * running the same compilation on another input (a probe). Throws like cpp_compile for wrappers and
 * unsupported flags.
 */
export function probeInvocation(entry: CompilationEntry): { compiler: string; args: string[]; cwd: string } {
  checkCompiler(entry.argv[0] ?? "");
  const args = syntaxArguments(entry.argv.slice(1))
    .filter(arg => arg !== "-fsyntax-only" && canonical(resolve(entry.directory, arg)) !== entry.file);
  return { compiler: entryCompiler(entry.argv[0]!, entry.directory), args, cwd: entry.directory };
}

export function resolveCompileInvocation(cwd: string, options: CompileOptions): CompileInvocation {
  const file = resolve(cwd, options.file);
  const database = findCompilationDatabase(cwd, file, options.build_dir);
  if (database) {
    const entries = readEntries(database);
    const entry = entries.find((value) => isEntry(value) && canonical(resolve(dirname(database), value.directory, value.file)) === canonical(file));
    if (!entry) throw new Error(`No compilation database entry for ${file} in ${database}; select the correct build_dir or add this file to the build`);
    const directory = resolve(dirname(database), entry.directory);
    const argv = entryArgv(entry);
    const compiler = options.compiler ?? argv[0];
    if (!compiler) throw new Error("Compilation command is empty");
    // An override cannot safely unwrap a launcher or environment-assignment prefix.
    checkCompiler(argv[0]);
    checkCompiler(compiler);
    const driver = entryCompiler(compiler, directory);
    return { compiler: driver, args: syntaxArguments(argv.slice(1), options.standard), cwd: directory, file, database };
  }
  const isC = extname(file) === ".c";
  const compiler = options.compiler ?? (isC ? "clang" : "clang++");
  checkCompiler(compiler);
  return { compiler, args: [`-std=${options.standard ?? (isC ? "c17" : "c++17")}`, "-fsyntax-only", "-Wall", "-Wextra", file], cwd, file };
}
