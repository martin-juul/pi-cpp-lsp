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

export function syntaxArguments(args: string[], standard?: string): string[] {
  const result: string[] = [];
  const takesOutput = new Set(["-o", "--output", "-MF", "-MT", "-MQ", "-MJ", "-dependency-file", "--serialize-diagnostics", "-serialize-diagnostics"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
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

export function resolveCompileInvocation(cwd: string, options: CompileOptions): CompileInvocation {
  const file = resolve(cwd, options.file);
  const database = findCompilationDatabase(cwd, file, options.build_dir);
  if (database) {
    let entries: unknown;
    try { entries = JSON.parse(readFileSync(database, "utf8")); }
    catch (err) { throw new Error(`Cannot read compilation database ${database}: ${(err as Error).message}`); }
    if (!Array.isArray(entries)) throw new Error(`Compilation database must contain an array: ${database}`);
    const entry = entries.find((value) => value && typeof value.file === "string" && typeof value.directory === "string" && canonical(resolve(dirname(database), value.directory, value.file)) === canonical(file));
    if (!entry) throw new Error(`No compilation database entry for ${file} in ${database}; select the correct build_dir or add this file to the build`);
    const directory = resolve(dirname(database), entry.directory);
    let argv: string[];
    if (entry.arguments !== undefined) {
      if (!Array.isArray(entry.arguments) || entry.arguments.length === 0 || !entry.arguments.every((arg: unknown) => typeof arg === "string")) throw new Error("Compilation entry arguments must be a nonempty string array");
      argv = entry.arguments;
    } else if (typeof entry.command === "string") argv = splitCommand(entry.command);
    else throw new Error("Compilation entry requires arguments or command");
    const compiler = options.compiler ?? argv[0];
    if (!compiler) throw new Error("Compilation command is empty");
    // An override cannot safely unwrap a launcher or environment-assignment prefix.
    checkCompiler(argv[0]);
    checkCompiler(compiler);
    const driver = compiler.includes("/") && !isAbsolute(compiler) ? resolve(directory, compiler) : compiler;
    return { compiler: driver, args: syntaxArguments(argv.slice(1), options.standard), cwd: directory, file, database };
  }
  const isC = extname(file) === ".c";
  const compiler = options.compiler ?? (isC ? "clang" : "clang++");
  checkCompiler(compiler);
  return { compiler, args: [`-std=${options.standard ?? (isC ? "c17" : "c++17")}`, "-fsyntax-only", "-Wall", "-Wextra", file], cwd, file };
}
