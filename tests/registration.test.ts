import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/index.ts";

// What pi-cpp-lsp 2.0.0 registered, captured from the 2.0.0 extension before the core moved out.
// pi must keep seeing exactly these tools and commands.
const TOOLS_2_0_0 = [
  {
    name: "cpp_build",
    label: "C++ Build",
    description: "Build an already configured CMake build directory. Does not configure the project.",
    promptSnippet: "Build configured CMake projects with optional target, configuration, and parallel jobs",
    parameters: {"type":"object","properties":{"build_dir":{"type":"string","minLength":1,"description":"Configured CMake build directory (default: the extension's managed build directory when the CMake project model is ready, otherwise 'build')"},"config":{"type":"string","minLength":1,"description":"Build configuration, for example Debug or Release"},"parallel":{"type":"integer","minimum":1,"description":"Maximum parallel jobs"},"timeout_ms":{"type":"integer","minimum":1,"maximum":600000,"description":"Command timeout in milliseconds (default: 120000, maximum: 600000)"},"target":{"type":"string","minLength":1,"description":"CMake target to build (default: all default targets)"}}},
  },
  {
    name: "cpp_test",
    label: "C++ Test",
    description: "Run CTest in an existing build directory, showing failing test output. Fails if no tests match. Build first with cpp_build.",
    promptSnippet: "Run CTest with optional test name regex, configuration, and parallel jobs",
    parameters: {"type":"object","properties":{"build_dir":{"type":"string","minLength":1,"description":"Configured CMake build directory (default: the extension's managed build directory when the CMake project model is ready, otherwise 'build')"},"config":{"type":"string","minLength":1,"description":"Build configuration, for example Debug or Release"},"parallel":{"type":"integer","minimum":1,"description":"Maximum parallel jobs"},"timeout_ms":{"type":"integer","minimum":1,"maximum":600000,"description":"Command timeout in milliseconds (default: 120000, maximum: 600000)"},"regex":{"type":"string","description":"Run tests whose names match this CTest regular expression"}}},
  },
  {
    name: "cpp_run",
    label: "C++ Run",
    description: "Run a built executable target of the CMake project with arguments. Resolves the executable from the project model; build it first with cpp_build.",
    promptSnippet: "Run a CMake executable target with arguments, a working directory and a timeout",
    parameters: {"type":"object","required":["target"],"properties":{"target":{"type":"string","minLength":1,"description":"Executable target to run"},"args":{"type":"array","items":{"type":"string"},"description":"Arguments passed to the executable"},"cwd":{"type":"string","minLength":1,"description":"Working directory (default: the CMake source root)"},"timeout_ms":{"type":"integer","minimum":1,"maximum":600000,"description":"Command timeout in milliseconds (default: 120000, maximum: 600000)"}}},
  },
  {
    name: "cpp_project",
    label: "C++ Project",
    description: "Query the CMake project model the extension configures. Actions: overview (the full project briefing: targets, standards, drift, notes), targets (list targets), target (one target's sources, include directories, defines, standard and dependencies; needs name), owner (the targets that build a file and the C++ standard it must stay valid for; needs path), refresh (reconfigure now and return the result), presets (list the configure presets, the active one and the default; read-only, the user switches presets with /cpp-preset).",
    promptSnippet: "Query the CMake project: targets, a target's sources/flags/standard, a file's owning targets, configure presets, or force a reconfigure",
    parameters: {"type":"object","required":["action"],"properties":{"action":{"enum":["overview","targets","target","owner","refresh","presets"],"description":"overview | targets | target | owner | refresh | presets"},"name":{"type":"string","minLength":1,"description":"Target name, for action target"},"path":{"type":"string","minLength":1,"description":"File path, absolute or relative to the working directory, for action owner"}}},
  },
  {
    name: "cpp_hover",
    label: "C++ Hover",
    description: "Get C/C++ symbol types, signatures and documentation using clangd.",
    promptSnippet: "Inspect C/C++ symbol types and documentation with clangd",
    parameters: {"type":"object","required":["file","line","column"],"properties":{"file":{"type":"string","description":"Source path, absolute or relative to the project cwd"},"line":{"type":"integer","minimum":1,"description":"1-based line"},"column":{"type":"integer","minimum":1,"description":"1-based UTF-16 column (JavaScript string offsets + 1)"},"build_dir":{"type":"string","description":"Directory containing compile_commands.json, relative to the project cwd (default: the managed CMake build directory once the project model is ready, else clangd's own search upward from the source file)"}}},
  },
  {
    name: "cpp_definition",
    label: "C++ Definition",
    description: "Find C/C++ symbol definitions using clangd. Returns 1-based UTF-16 locations.",
    promptSnippet: "Find C/C++ symbol definition locations with clangd",
    parameters: {"type":"object","required":["file","line","column"],"properties":{"file":{"type":"string","description":"Source path, absolute or relative to the project cwd"},"line":{"type":"integer","minimum":1,"description":"1-based line"},"column":{"type":"integer","minimum":1,"description":"1-based UTF-16 column (JavaScript string offsets + 1)"},"build_dir":{"type":"string","description":"Directory containing compile_commands.json, relative to the project cwd (default: the managed CMake build directory once the project model is ready, else clangd's own search upward from the source file)"}}},
  },
  {
    name: "cpp_references",
    label: "C++ References",
    description: "Find all references to the C/C++ symbol at a position across the CMake project, using clangd's project index. Returns 1-based file:line:column locations, including the declaration and definition.",
    promptSnippet: "Find every reference to a C/C++ symbol with clangd instead of grep",
    parameters: {"type":"object","required":["file","line","column"],"properties":{"file":{"type":"string","description":"Source or header path, absolute or relative to the project cwd"},"line":{"type":"integer","minimum":1,"description":"1-based line"},"column":{"type":"integer","minimum":1,"description":"1-based UTF-16 column (JavaScript string offsets + 1)"}}},
  },
  {
    name: "cpp_symbols",
    label: "C++ Symbols",
    description: "Search C/C++ symbols by name across the CMake project (query), or list the outline of one file (file) with members nested under their class. Returns 1-based locations.",
    promptSnippet: "Search C/C++ symbols by name across the project, or outline a file, with clangd",
    parameters: {"type":"object","properties":{"query":{"type":"string","minLength":1,"description":"Symbol name or fuzzy fragment to search the whole project for"},"file":{"type":"string","minLength":1,"description":"File to outline, absolute or relative to the project cwd"}}},
  },
  {
    name: "cpp_calls",
    label: "C++ Calls",
    description: "List the incoming calls (callers) or outgoing calls (callees) of the C/C++ function at a position, using clangd's call hierarchy and project index. Returns 1-based locations.",
    promptSnippet: "Find the callers or callees of a C/C++ function with clangd",
    parameters: {"type":"object","required":["file","line","column","direction"],"properties":{"file":{"type":"string","description":"Source or header path, absolute or relative to the project cwd"},"line":{"type":"integer","minimum":1,"description":"1-based line"},"column":{"type":"integer","minimum":1,"description":"1-based UTF-16 column (JavaScript string offsets + 1)"},"direction":{"enum":["incoming","outgoing"],"description":"incoming (who calls it) | outgoing (what it calls)"}}},
  },
  {
    name: "cpp_types",
    label: "C++ Types",
    description: "List the base classes (supertypes) or derived classes (subtypes) of the C/C++ type at a position, using clangd's type hierarchy and project index. Returns 1-based locations.",
    promptSnippet: "Find the base or derived classes of a C++ type with clangd",
    parameters: {"type":"object","required":["file","line","column","direction"],"properties":{"file":{"type":"string","description":"Source or header path, absolute or relative to the project cwd"},"line":{"type":"integer","minimum":1,"description":"1-based line"},"column":{"type":"integer","minimum":1,"description":"1-based UTF-16 column (JavaScript string offsets + 1)"},"direction":{"enum":["supertypes","subtypes"],"description":"supertypes (base classes) | subtypes (derived classes)"}}},
  },
  {
    name: "cpp_rename",
    label: "C++ Rename",
    description: "Rename the C/C++ symbol at a position across the CMake project with clangd, editing every file that uses it. The rename is refused, changing nothing, when clangd cannot rename the symbol, its index is still building, or an edit would land outside the project or in a build or dependency directory. Lists every changed file with its clangd diagnostics.",
    promptSnippet: "Rename a C/C++ symbol across the project with clangd instead of editing each use",
    parameters: {"type":"object","required":["file","line","column","new_name"],"properties":{"file":{"type":"string","description":"Source or header path, absolute or relative to the project cwd"},"line":{"type":"integer","minimum":1,"description":"1-based line"},"column":{"type":"integer","minimum":1,"description":"1-based UTF-16 column (JavaScript string offsets + 1)"},"new_name":{"type":"string","minLength":1,"description":"The new identifier"}}},
  },
  {
    name: "cpp_check",
    label: "C++ Check",
    description: "Run static analysis (clang-tidy and/or cppcheck) on C/C++ source files. Returns lint warnings and suggestions.",
    promptSnippet: "Run clang-tidy and cppcheck static analysis on C/C++ files",
    promptGuidelines: ["Use cpp_check when the user asks to lint, check, or analyze C/C++ code for issues."],
    parameters: {"type":"object","required":["file"],"properties":{"file":{"type":"string","description":"Path to the C/C++ source file to check"},"build_dir":{"type":"string","description":"Directory containing compile_commands.json (default: the managed CMake build directory when the project model is ready, otherwise the first compile_commands.json found in the cwd or a parent directory of the file, directly or under build/)"},"tool":{"type":"string","description":"Which tool to use: 'clang-tidy', 'cppcheck', or 'all' (default: 'all')"}}},
  },
  {
    name: "cpp_compile",
    label: "C++ Compile Check",
    description: "Syntax-check a C/C++ source using its compilation database command when available. Falls back to clang (C17) or clang++ (C++17).",
    promptSnippet: "Compile-check C/C++ files to verify they build",
    promptGuidelines: ["Use cpp_compile when the user wants to verify C/C++ code compiles cleanly."],
    parameters: {"type":"object","required":["file"],"properties":{"file":{"type":"string","description":"Path to the C/C++ source file to compile"},"build_dir":{"type":"string","description":"Directory containing compile_commands.json (default: the managed CMake build directory when the project model is ready, otherwise the first compile_commands.json found in the cwd or a parent directory of the file, directly or under build/)"},"standard":{"type":"string","description":"Override the compilation database language standard (standalone defaults: c17 for .c, c++17 otherwise)"},"compiler":{"type":"string","description":"Override the GCC/Clang compiler driver (default: database compiler, or clang/clang++ for standalone files)"}}},
  },
  {
    name: "cpp_format",
    label: "C++ Format",
    description: "Format C/C++ files using clang-format. Applies formatting in-place.",
    promptSnippet: "Format C/C++ files with clang-format",
    promptGuidelines: ["Use cpp_format when the user wants to format or beautify C/C++ code."],
    parameters: {"type":"object","required":["files"],"properties":{"files":{"type":"array","items":{"type":"string"},"description":"Paths to C/C++ files to format"},"style":{"type":"string","description":"clang-format style: 'file', 'google', 'llvm', 'chromium', etc. (default: 'file')"}}},
  },
  {
    name: "cpp_gen_compdb",
    label: "Generate compile_commands.json",
    description: "Generate compile_commands.json for the project with CMake or Bear. clangd needs it for features such as go-to-definition.",
    promptSnippet: "Generate compile_commands.json for clangd",
    promptGuidelines: ["Use cpp_gen_compdb when clangd needs a compile_commands.json, when headers aren't found, or when the user asks to set up the compilation database."],
    parameters: {"type":"object","properties":{"method":{"type":"string","description":"'cmake' or 'bear' (default: cmake when the cwd has a CMakeLists.txt, else bear when it has a Makefile)"},"build_dir":{"type":"string","description":"Build directory for CMake (default: 'build')"}}},
  },
];

const COMMANDS_2_0_0 = [
  { name: "cpp-preset", description: "List the CMake configure presets, or switch to one and reconfigure: /cpp-preset [name]" },
  { name: "cpp-setup", description: "Check the C/C++ toolchain (clangd, clang-format, clang-tidy, cppcheck, cmake, ninja) and which features it supports" },
];

/** Plain JSON, as pi and an MCP client see it: TypeBox's symbol keys and undefined fields drop out. */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("the pi extension registers the 2.0.0 tools and commands, in the same order", () => {
  const tools: unknown[] = [];
  const commands: unknown[] = [];
  extension({
    registerTool(tool: any) {
      const { name, label, description, promptSnippet, promptGuidelines, parameters } = tool;
      tools.push(plain({ name, label, description, promptSnippet, promptGuidelines, parameters }));
    },
    on() {},
    registerCommand(name: string, command: any) { commands.push({ name, description: command.description }); },
  } as unknown as ExtensionAPI);
  assert.deepEqual(tools, TOOLS_2_0_0);
  assert.deepEqual(commands, COMMANDS_2_0_0);
});
