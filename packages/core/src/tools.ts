import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { buildToolSpecs } from "./build.ts";
import { clangdToolSpecs, type ClangdOptions } from "./clangd.ts";
import { findCompilationDatabase, resolveCompileInvocation } from "./compdb.ts";
import type { PostEditOptions } from "./diagnostics.ts";
import type { Exec } from "./exec.ts";
import { navigationToolSpecs } from "./navigation.ts";
import { truncateOutput } from "./output.ts";
import type { ProjectModel } from "./project/model.ts";
import { projectToolSpec } from "./project/tools.ts";
import { renameToolSpec } from "./rename.ts";
import type { CppSession } from "./session.ts";

/** One part of a tool result. Both pi and MCP take results as a list of these. */
export interface ToolText {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolText[];
  /** Structured data for the harness's UI and tests; the model sees only `content`. */
  details: unknown;
  isError?: boolean;
}

/** What a tool call gets from the harness. */
export interface ToolContext {
  /** Relative paths in the parameters resolve against this. */
  cwd: string;
  signal?: AbortSignal;
  /** Shows progress while the tool runs; harnesses that cannot show it leave it out. */
  onUpdate?: (partial: ToolResult) => void;
}

/**
 * A harness-neutral tool. `parameters` is a TypeBox schema, which is plain JSON Schema at runtime,
 * so the same object serves as pi's parameters and as an MCP input schema.
 */
export interface ToolSpec<P extends TSchema = TSchema> {
  name: string;
  /** pi's display name. */
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines?: string[];
  parameters: P;
  execute(params: Static<P>, context: ToolContext): Promise<ToolResult>;
}

/** Types `execute`'s parameters from the schema. */
export function defineTool<P extends TSchema>(spec: ToolSpec<P>): ToolSpec<P> {
  return spec;
}

/** Whether `name` is on PATH. A harness's exec reports a missing program only as a failed run. */
async function hasCommand(exec: Exec, name: string): Promise<boolean> {
  const r = await exec("sh", ["-c", 'command -v "$1"', "sh", name], { timeout: 5000 });
  return r.code === 0;
}

const BUILD_DIR_DESCRIPTION = "Directory containing compile_commands.json (default: the managed CMake build directory when the project model is ready, otherwise the first compile_commands.json found in the cwd or a parent directory of the file, directly or under build/)";

/**
 * cpp_check, cpp_compile, cpp_format and cpp_gen_compdb. Without an explicit build_dir, cpp_check and
 * cpp_compile use the session's ready CMake model, read on every call.
 */
export function compileToolSpecs(exec: Exec, projectModel: () => ProjectModel | undefined = () => undefined): ToolSpec[] {
  const check = defineTool({
    name: "cpp_check",
    label: "C++ Check",
    description:
      "Run static analysis (clang-tidy and/or cppcheck) on C/C++ source files. Returns lint warnings and suggestions.",
    promptSnippet: "Run clang-tidy and cppcheck static analysis on C/C++ files",
    promptGuidelines: [
      "Use cpp_check when the user asks to lint, check, or analyze C/C++ code for issues.",
    ],
    parameters: Type.Object({
      file: Type.String({ description: "Path to the C/C++ source file to check" }),
      build_dir: Type.Optional(Type.String({ description: BUILD_DIR_DESCRIPTION })),
      tool: Type.Optional(
        Type.String({
          description: "Which tool to use: 'clang-tidy', 'cppcheck', or 'all' (default: 'all')",
        })
      ),
    }),
    async execute(params, { cwd, signal, onUpdate }) {
      const tool = params.tool ?? "all";
      const file = resolve(cwd, params.file);
      let database: string | undefined;
      try {
        database = findCompilationDatabase(cwd, file, params.build_dir ?? projectModel()?.buildDir);
      } catch (err) {
        return { content: [{ type: "text", text: (err as Error).message }], details: { file, error: true }, isError: true };
      }
      const results: string[] = [];
      let failed = false;
      const checks = tool === "all" ? ["clang-tidy", "cppcheck"] : [tool];

      for (const checker of checks) {
        onUpdate?.({
          content: [{ type: "text", text: `Running ${checker}...` }],
          details: {},
        });

        if (checker !== "clang-tidy" && checker !== "cppcheck") {
          failed = true;
          results.push(`=== ${checker} ===\nUnknown tool. Use 'clang-tidy', 'cppcheck', or 'all'.`);
          continue;
        }
        if (!(await hasCommand(exec, checker))) {
          failed = true;
          results.push(`=== ${checker} ===\nTool not available: ${checker} is not installed or not on PATH`);
          continue;
        }

        try {
          let result;
          if (checker === "clang-tidy") {
            result = await exec("clang-tidy", [file, ...(database ? ["-p", dirname(database)] : [])], {
              cwd,
              signal,
              timeout: 30000,
            });
          } else {
            result = await exec("cppcheck", [
              "--enable=all",
              "--suppress=missingIncludeSystem",
              file,
            ], { signal, cwd, timeout: 30000 });
          }

          const success = result.code === 0 && !result.killed && !signal?.aborted;
          failed ||= !success;
          const output = result.stdout + (result.stderr ? "\n" + result.stderr : "");
          results.push(
            `=== ${checker} (exit ${result.code}${result.killed || signal?.aborted ? "; interrupted" : ""}) ===\n${output.trim() || (success ? "No issues found ✓" : "Analysis failed without diagnostic output")}`
          );
        } catch (err) {
          failed = true;
          results.push(
            `=== ${checker} ===\nTool not available: ${(err as Error).message}`
          );
        }
      }

      return {
        content: [{ type: "text", text: truncateOutput(`Compilation database: ${database ?? "none found"}\n\n${results.join("\n\n")}`) }],
        details: { file: params.file, tool, database, success: !failed },
        isError: failed,
      };
    },
  });

  const compile = defineTool({
    name: "cpp_compile",
    label: "C++ Compile Check",
    description:
      "Syntax-check a C/C++ source using its compilation database command when available. Falls back to clang (C17) or clang++ (C++17).",
    promptSnippet: "Compile-check C/C++ files to verify they build",
    promptGuidelines: [
      "Use cpp_compile when the user wants to verify C/C++ code compiles cleanly.",
    ],
    parameters: Type.Object({
      file: Type.String({ description: "Path to the C/C++ source file to compile" }),
      build_dir: Type.Optional(Type.String({ description: BUILD_DIR_DESCRIPTION })),
      standard: Type.Optional(
        Type.String({
          description: "Override the compilation database language standard (standalone defaults: c17 for .c, c++17 otherwise)",
        })
      ),
      compiler: Type.Optional(
        Type.String({
          description: "Override the GCC/Clang compiler driver (default: database compiler, or clang/clang++ for standalone files)",
        })
      ),
    }),
    async execute(params, context) {
      const { signal } = context;
      try {
        const invocation = resolveCompileInvocation(context.cwd, { ...params, build_dir: params.build_dir ?? projectModel()?.buildDir });
        const { compiler, args, cwd, database } = invocation;
        const result = await exec(compiler, args, { signal, cwd, timeout: 30000 });
        const success = result.code === 0 && !result.killed && !signal?.aborted;
        const output = (result.stdout + "\n" + result.stderr).trim();
        return {
          content: [{ type: "text", text: truncateOutput(
            `${success ? "✓ Compilation successful" : "✗ Compilation failed"} (${compiler}${database ? `; ${database}` : "; standalone defaults"})${output ? `:\n${output}` : ""}`
          ) }],
          details: { file: invocation.file, compiler, args, cwd, database, success, exitCode: result.code },
          isError: !success,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Compile check failed: ${(err as Error).message}` }],
          details: { file: params.file, error: true },
          isError: true,
        };
      }
    },
  });

  const format = defineTool({
    name: "cpp_format",
    label: "C++ Format",
    description:
      "Format C/C++ files using clang-format. Applies formatting in-place.",
    promptSnippet: "Format C/C++ files with clang-format",
    promptGuidelines: [
      "Use cpp_format when the user wants to format or beautify C/C++ code.",
    ],
    parameters: Type.Object({
      files: Type.Array(Type.String(), {
        description: "Paths to C/C++ files to format",
      }),
      style: Type.Optional(
        Type.String({
          description: "clang-format style: 'file', 'google', 'llvm', 'chromium', etc. (default: 'file')",
        })
      ),
    }),
    async execute(params, { signal }) {
      const style = params.style ?? "file";
      const args = [`--style=${style}`, ...params.files];

      if (!(await hasCommand(exec, "clang-format"))) {
        return {
          content: [
            {
              type: "text",
              text: "clang-format not available: install LLVM and make sure clang-format is on PATH",
            },
          ],
          details: { error: true },
        };
      }

      try {
        const result = await exec("clang-format", ["-i", ...args], {
          signal,
          timeout: 15000,
        });

        if (result.code === 0) {
          return {
            content: [
              {
                type: "text",
                text: `✓ Formatted ${params.files.length} file(s) with clang-format (${style})`,
              },
            ],
            details: { files: params.files, style },
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `clang-format failed:\n${result.stderr}`,
            },
          ],
          details: { files: params.files, error: true },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `clang-format not available: ${(err as Error).message}`,
            },
          ],
          details: { error: true },
        };
      }
    },
  });

  const genCompdb = defineTool({
    name: "cpp_gen_compdb",
    label: "Generate compile_commands.json",
    description:
      "Generate compile_commands.json for the project with CMake or Bear. clangd needs it for features such as go-to-definition.",
    promptSnippet: "Generate compile_commands.json for clangd",
    promptGuidelines: [
      "Use cpp_gen_compdb when clangd needs a compile_commands.json, when headers aren't found, or when the user asks to set up the compilation database.",
    ],
    parameters: Type.Object({
      method: Type.Optional(
        Type.String({
          description: "'cmake' or 'bear' (default: cmake when the cwd has a CMakeLists.txt, else bear when it has a Makefile)",
        })
      ),
      build_dir: Type.Optional(
        Type.String({
          description: "Build directory for CMake (default: 'build')",
        })
      ),
    }),
    async execute(params, { cwd, signal, onUpdate }) {
      const buildDir = params.build_dir ?? "build";
      const method = params.method ?? "auto";

      let useCmake = method === "cmake";
      let useBear = method === "bear";

      if (method === "auto") {
        if (existsSync(join(cwd, "CMakeLists.txt"))) {
          useCmake = true;
        } else if (existsSync(join(cwd, "Makefile")) || existsSync(join(cwd, "makefile"))) {
          useBear = true;
        }
      }

      if (useCmake) {
        if (!(await hasCommand(exec, "cmake"))) {
          return {
            content: [{ type: "text", text: "cmake not available: install CMake and make sure it is on PATH" }],
            details: { error: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Generating compile_commands.json with CMake..." }],
          details: {},
        });

        try {
          const result = await exec(
            "cmake",
            ["-DCMAKE_EXPORT_COMPILE_COMMANDS=ON", "-B", buildDir],
            { signal, cwd, timeout: 60000 }
          );

          if (result.code === 0) {
            // Symlink to project root
            await exec("ln", ["-sf", `${buildDir}/compile_commands.json`, "."], { cwd });

            return {
              content: [
                {
                  type: "text",
                  text: `✓ compile_commands.json generated in ${buildDir}/ and symlinked to project root`,
                },
              ],
              details: { method: "cmake", buildDir },
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `CMake failed:\n${result.stdout}\n${result.stderr}`,
              },
            ],
            details: { method: "cmake", error: true },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `cmake not available: ${(err as Error).message}`,
              },
            ],
            details: { error: true },
          };
        }
      }

      if (useBear) {
        if (!(await hasCommand(exec, "bear"))) {
          return {
            content: [{ type: "text", text: "bear not available: install Bear (e.g. brew install bear, apt install bear)" }],
            details: { error: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Generating compile_commands.json with Bear..." }],
          details: {},
        });

        try {
          const result = await exec("bear", ["--", "make"], {
            signal,
            cwd,
            timeout: 120000,
          });

          if (result.code === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "✓ compile_commands.json generated with Bear",
                },
              ],
              details: { method: "bear" },
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `Bear failed:\n${result.stdout}\n${result.stderr}`,
              },
            ],
            details: { method: "bear", error: true },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `bear not available: ${(err as Error).message}. Install with: brew install bear`,
              },
            ],
            details: { error: true },
          };
        }
      }

      return {
        content: [
          {
            type: "text",
            text: "Could not determine build system (no CMakeLists.txt or Makefile in the project root). Pass method: 'cmake' or 'bear' explicitly.",
          },
        ],
        details: { error: true },
      };
    },
  });

  return [check, compile, format, genCompdb];
}

export interface CppToolsOptions extends Pick<PostEditOptions, "waitMs" | "firstOpenWaitMs"> {
  /** Runs every command the tools start. */
  exec: Exec;
  /** How cpp_hover and cpp_definition start clangd for an explicit build_dir. */
  clangd?: ClangdOptions;
}

export interface CppTools {
  /** Every cpp_* tool, in the order pi registers them. */
  specs: ToolSpec[];
  /** Shuts down the clangd connections cpp_hover and cpp_definition opened for explicit build directories. */
  close(): Promise<void>;
}

/**
 * Every cpp_* tool for the harness's current session, read on every call: before a session or
 * outside a CMake project the tools keep their non-CMake behavior.
 */
export function cppTools(session: () => CppSession | undefined, options: CppToolsOptions): CppTools {
  const { exec } = options;
  const projectModel = () => session()?.project.model;
  const managed = () => session()?.clangd;
  const clangd = clangdToolSpecs(managed, options.clangd);
  const specs = [
    ...buildToolSpecs(exec, projectModel),
    projectToolSpec(() => session()?.project),
    ...clangd.specs,
    ...navigationToolSpecs(managed),
    renameToolSpec(managed, {
      exec,
      getProject: () => session()?.project,
      toolchain: () => session()?.toolchain,
      log: message => session()?.log(message),
      waitMs: options.waitMs,
      firstOpenWaitMs: options.firstOpenWaitMs,
    }),
    ...compileToolSpecs(exec, projectModel),
  ];
  return { specs, close: () => clangd.close() };
}
