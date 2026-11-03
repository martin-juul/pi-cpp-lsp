import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerBuildTools } from "./lib/build.ts";
import { registerClangdTools } from "./lib/clangd.ts";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@earendil-works/pi-coding-agent";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findCompilationDatabase, resolveCompileInvocation } from "./lib/compdb.ts";
import { ProjectService, type ProjectServiceOptions } from "./lib/project/session.ts";
import { registerProjectTools } from "./lib/project/tools.ts";
import { registerNavigationTools } from "./lib/navigation.ts";
import { registerRenameTool } from "./lib/rename.ts";
import { postEditNote, resolveToolPath, type PostEditOptions } from "./lib/diagnostics.ts";
import { isSupportedCmake, probeCmake, supportsPresets, type CmakeVersion } from "./lib/project/configure.ts";

const FIXED_GUIDELINES = [
  "Prefer smart pointers over raw new/delete in C++ code.",
  "Ensure compile_commands.json exists for proper clangd support.",
  "Use minimal diffs when editing C/C++ files.",
];
// In CMake sessions the model drives the standard guidance (R9, KTD5).
const STANDARD_GUIDELINE =
  "Write C/C++ code that is valid for the C++ standard of the target that owns the file you edit; the project briefing lists each target's standard.";

/** The clangd major version that first supports each navigation feature (see navigation.ts). */
const CLANGD_FEATURES: { feature: string; major: number }[] = [
  { feature: "incoming calls (cpp_calls)", major: 12 },
  { feature: "type hierarchy (cpp_types)", major: 16 },
  { feature: "outgoing calls (cpp_calls)", major: 21 },
];

/** /cpp-setup lines for the navigation features the clangd `--version` line supports. */
function clangdFeatures(versionLine: string): string[] {
  const match = versionLine.match(/clangd version (\d+)/);
  if (!match) return ["  ? navigation features: could not read the clangd version"];
  const major = Number(match[1]);
  return CLANGD_FEATURES.map(({ feature, major: needed }) =>
    major >= needed ? `  ✓ ${feature}` : `  ✗ ${feature.replace(/ \(.*\)$/, "")}: needs clangd ${needed} or newer`);
}

/** /cpp-setup lines for the CMake features this version supports (KTD18). */
function cmakeFeatures(cmake: CmakeVersion): string[] {
  return [
    isSupportedCmake(cmake)
      ? "  ✓ project model (briefing, drift, managed build)"
      : "  ✗ project model: needs CMake 3.14 or newer; CMake projects are treated like non-CMake ones",
    supportsPresets(cmake) ? "  ✓ presets (/cpp-preset)" : "  ✗ presets: need CMake 3.19 or newer",
  ];
}

export interface ExtensionOptions {
  /** Overrides for the per-session project service, such as a shorter report-point wait. */
  project?: Pick<ProjectServiceOptions, "waitMs">;
  /** Overrides for the post-edit diagnostics wait bounds. */
  diagnostics?: Pick<PostEditOptions, "waitMs" | "firstOpenWaitMs">;
}

function truncateOutput(output: string): string {
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let result = truncation.content;
  if (truncation.truncated) {
    const tempFile = join(
      mkdtempSync(join(tmpdir(), "cpp-lsp-")),
      "output.txt"
    );
    writeFileSync(tempFile, output, "utf8");
    result += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${tempFile}]`;
  }
  return result;
}

export default function (pi: ExtensionAPI, options: ExtensionOptions = {}) {
  // Tools without an explicit build_dir default to the session's ready CMake model (KTD16).
  const projectModel = () => project?.model;
  registerBuildTools(pi, projectModel);
  registerProjectTools(pi, () => project);
  // pi.exec never throws: a missing binary resolves with a non-zero exit code,
  // so check availability explicitly before running a tool.
  async function hasCommand(name: string): Promise<boolean> {
    const r = await pi.exec("sh", ["-c", 'command -v "$1"', "sh", name], { timeout: 5000 });
    return r.code === 0;
  }

  // ── CMake project session ──────────────────────────────────────
  let project: ProjectService | undefined;

  pi.on("session_start", async (_event, ctx) => {
    project?.dispose();
    // Root discovery and configure run in the background (KTD20).
    project = new ProjectService({
      cwd: ctx.cwd,
      exec: (command, args, execOptions) => pi.exec(command, args, execOptions),
      notify: (message, level) => ctx.ui.notify(message, level),
      waitMs: options.project?.waitMs,
    });
  });

  // Registered after session_start so the managed clangd attaches to the new project at once (KTD11).
  const clangd = registerClangdTools(pi, { getProject: () => project });
  registerNavigationTools(pi, clangd);
  registerRenameTool(pi, clangd, { exec: (command, args, execOptions) => pi.exec(command, args, execOptions), getProject: () => project, ...options.diagnostics });

  pi.on("session_shutdown", async () => {
    project?.dispose();
    project = undefined;
  });

  pi.on("session_compact", async () => {
    project?.resendBriefing();
  });

  // ── Context injection ────────────────────────────────────────────
  pi.on("before_agent_start", async (event, _ctx) => {
    const service = project;
    await service?.ready();
    const cmake = service?.isCmake === true;
    event.systemPromptOptions.promptGuidelines = [
      ...(event.systemPromptOptions.promptGuidelines ?? []),
      ...(cmake ? [STANDARD_GUIDELINE] : FIXED_GUIDELINES),
    ];
    if (!service || !cmake) return;
    // Runs the extension itself started carry no new project information.
    if (event.messageType === "custom" && event.message.customType.startsWith("cpp-")) return;
    const message = await service.runMessage();
    return message ? { message } : undefined;
  });

  // ── Post-edit pipeline on write/edit, project report point on bash ─
  pi.on("tool_result", async (event, ctx) => {
    const notes: string[] = [];
    if (
      (event.toolName === "write" || event.toolName === "edit") &&
      !event.isError
    ) {
      const input = event.input as { path?: string };
      // Format, drift, owner and clangd diagnostics in one note (KTD13).
      const note = input.path
        ? await postEditNote(resolveToolPath(ctx.cwd, input.path), {
          exec: (command, args, execOptions) => pi.exec(command, args, execOptions),
          cwd: ctx.cwd, project, clangd, ...options.diagnostics,
        })
        : await project?.reportPoint();
      if (note) notes.push(`\n${note}`);
    } else if (event.toolName === "bash") {
      const drift = await project?.reportPoint();
      if (drift) notes.push(`\n${drift}`);
    }
    if (notes.length > 0) {
      return {
        content: [
          ...event.content,
          ...notes.map(text => ({ type: "text" as const, text })),
        ],
      };
    }
  });

  // ── Register /cpp-setup command ──────────────────────────────────
  pi.registerCommand("cpp-setup", {
    description: "Check the C/C++ toolchain (clangd, clang-format, clang-tidy, cppcheck, cmake, ninja) and which features it supports",
    handler: async (_args, ctx) => {
      const tools = [
        { name: "clangd", check: "clangd --version", install: "brew install llvm" },
        { name: "clang-format", check: "clang-format --version", install: "brew install llvm" },
        { name: "clang-tidy", check: "clang-tidy --version", install: "brew install llvm" },
        { name: "cppcheck", check: "cppcheck --version", install: "brew install cppcheck" },
        { name: "cmake", check: "", install: "brew install cmake" },
        { name: "ctest", check: "ctest --version", install: "brew install cmake" },
        { name: "ninja", check: "ninja --version", install: "brew install ninja (optional; the managed build falls back to Unix Makefiles)" },
      ];

      const results: string[] = [];
      for (const tool of tools) {
        if (tool.name === "cmake") {
          const cmake = await probeCmake((command, args, execOptions) => pi.exec(command, args, execOptions));
          if (cmake) results.push(`✓ cmake: ${cmake.text}`, ...cmakeFeatures(cmake));
          else results.push(`✗ cmake: not found — install with: ${tool.install}`);
          continue;
        }
        try {
          const r = await pi.exec("sh", ["-c", tool.check], { timeout: 5000 });
          if (r.code === 0) {
            const version = r.stdout.trim().split("\n")[0];
            results.push(`✓ ${tool.name}: ${version}`);
            if (tool.name === "clangd") results.push(...clangdFeatures(version));
          } else {
            results.push(`✗ ${tool.name}: not found — install with: ${tool.install}`);
          }
        } catch {
          results.push(`✗ ${tool.name}: not found — install with: ${tool.install}`);
        }
      }

      ctx.ui.notify(results.join("\n"), "info");
    },
  });

  // ── Tool: cpp-check ──────────────────────────────────────────────
  pi.registerTool({
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
      build_dir: Type.Optional(Type.String({ description: "Directory containing compile_commands.json (default: the managed CMake build directory when the project model is ready, otherwise auto-detect project root or build/)" })),
      tool: Type.Optional(
        Type.String({
          description: "Which tool to use: 'clang-tidy', 'cppcheck', or 'all' (default: 'all')",
        })
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const tool = params.tool ?? "all";
      const file = resolve(ctx.cwd, params.file);
      let database: string | undefined;
      try {
        database = findCompilationDatabase(ctx.cwd, file, params.build_dir ?? projectModel()?.buildDir);
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
        if (!(await hasCommand(checker))) {
          failed = true;
          results.push(`=== ${checker} ===\nTool not available: ${checker} is not installed or not on PATH`);
          continue;
        }

        try {
          let result;
          if (checker === "clang-tidy") {
            result = await pi.exec("clang-tidy", [file, ...(database ? ["-p", dirname(database)] : [])], {
              cwd: ctx.cwd,
              signal,
              timeout: 30000,
            });
          } else {
            result = await pi.exec("cppcheck", [
              "--enable=all",
              "--suppress=missingIncludeSystem",
              file,
            ], { signal, cwd: ctx.cwd, timeout: 30000 });
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

  // ── Tool: cpp_compile ────────────────────────────────────────────
  pi.registerTool({
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
      build_dir: Type.Optional(Type.String({ description: "Directory containing compile_commands.json (default: the managed CMake build directory when the project model is ready, otherwise auto-detect project root or build/)" })),
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
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const invocation = resolveCompileInvocation(ctx.cwd, { ...params, build_dir: params.build_dir ?? projectModel()?.buildDir });
        const { compiler, args, cwd, database } = invocation;
        const result = await pi.exec(compiler, args, { signal, cwd, timeout: 30000 });
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

  // ── Tool: cpp_format ─────────────────────────────────────────────
  pi.registerTool({
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
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const style = params.style ?? "file";
      const args = [`--style=${style}`, ...params.files];

      if (!(await hasCommand("clang-format"))) {
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
        const result = await pi.exec("clang-format", ["-i", ...args], {
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

  // ── Tool: cpp_gen_compdb ─────────────────────────────────────────
  pi.registerTool({
    name: "cpp_gen_compdb",
    label: "Generate compile_commands.json",
    description:
      "Generate a compile_commands.json for the project using CMake or Bear, enabling clangd features like go-to-definition.",
    promptSnippet: "Generate compile_commands.json for clangd",
    promptGuidelines: [
      "Use cpp_gen_compdb when clangd needs a compile_commands.json, when headers aren't found, or when the user asks to set up the compilation database.",
    ],
    parameters: Type.Object({
      method: Type.Optional(
        Type.String({
          description: "Method: 'cmake' or 'bear' (default: auto-detect)",
        })
      ),
      build_dir: Type.Optional(
        Type.String({
          description: "Build directory for CMake (default: 'build')",
        })
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const buildDir = params.build_dir ?? "build";
      const method = params.method ?? "auto";
      const cwd = ctx.cwd;

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
        if (!(await hasCommand("cmake"))) {
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
          const result = await pi.exec(
            "cmake",
            ["-DCMAKE_EXPORT_COMPILE_COMMANDS=ON", "-B", buildDir],
            { signal, cwd, timeout: 60000 }
          );

          if (result.code === 0) {
            // Symlink to project root
            await pi.exec("ln", ["-sf", `${buildDir}/compile_commands.json`, "."], { cwd });

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
        if (!(await hasCommand("bear"))) {
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
          const result = await pi.exec("bear", ["--", "make"], {
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
}
