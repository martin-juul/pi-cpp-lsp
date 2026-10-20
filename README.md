# pi-cpp-lsp

[![CI](https://github.com/martin-juul/pi-cpp-lsp/actions/workflows/ci.yml/badge.svg)](https://github.com/martin-juul/pi-cpp-lsp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pi-cpp-lsp.svg)](https://www.npmjs.com/package/pi-cpp-lsp)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Pi Package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![C++](https://img.shields.io/badge/C++-00599C?logo=cplusplus&logoColor=white)](https://isocpp.org/)

A [pi](https://pi.dev) extension providing C/C++ development support: formatting, static analysis, project-aware compile checks, clangd navigation, and CMake builds and tests.

## Install

From npm:

```bash
pi install npm:pi-cpp-lsp
```

From GitHub:

```bash
pi install git:github.com/martin-juul/pi-cpp-lsp
```

Or try it for a single session without installing:

```bash
pi -e npm:pi-cpp-lsp
```

## Quick Setup

Run the `/cpp-setup` command after installing to check your toolchain:

```text
/cpp-setup
```

Or use the `cpp-setup` skill (`/skill:cpp-setup`) for a guided walkthrough.

## Features

### Custom Tools

| Tool | Description |
|------|-------------|
| `cpp_check` | Run clang-tidy and/or cppcheck static analysis |
| `cpp_compile` | Syntax-check using project compilation flags or standalone C/C++ defaults |
| `cpp_format` | Format with clang-format |
| `cpp_gen_compdb` | Generate `compile_commands.json` via CMake or Bear |
| `cpp_hover` | Get type information and documentation from clangd |
| `cpp_definition` | Find a symbol's definition with clangd |
| `cpp_build` | Build a configured CMake project |
| `cpp_test` | Run a configured project's CTest tests |

### Project-Aware Checks

`cpp_compile` uses `compile_commands.json` when available, preserving the source file's include paths, defines, language flags, and working directory. Use `build_dir` to select a custom compilation database directory. Explicit `compiler` and `standard` options override the database settings. Without a database, standalone checks use C17 for `.c` files and C++17 for C++ files.

`cpp_check` also accepts `build_dir` to point clang-tidy at the project's compilation database. Compilation checks remain syntax-only; use `cpp_build` to catch linker errors.

Database checks currently support direct GCC/Clang commands. Compiler wrappers, response files, MSVC commands, and module/plugin or compiler pass-through flags are reported as unsupported. A malformed database or missing source entry produces an error rather than silently using standalone flags.

### Symbol Navigation

`cpp_hover` and `cpp_definition` accept `file`, `line`, and `column`, plus an optional `build_dir` for clangd's compilation database. Positions are **1-based**, with columns counted in UTF-16 code units. Results reflect files saved on disk. Clangd starts on demand and stops when the session shuts down.

For example, use `cpp_hover` with `{"file":"src/main.cpp","line":12,"column":5}` to inspect the symbol at that position. Accurate project flags are needed to resolve project headers and types.

### Building and Testing

Configure the project first, using `cpp_gen_compdb` or your project's normal CMake configuration command. Then:

- `cpp_build` accepts `build_dir` (default `build`), optional `target`, `config`, and `parallel`.
- `cpp_test` accepts `build_dir`, optional test-name `regex`, `config`, and `parallel`. Build test executables before running it. Selecting no tests is reported as a failure.
- Both tools accept `timeout_ms` (default 120000, maximum 600000), support cancellation, and report command output and exit status. Large output is saved to a temporary log.

### Auto-Formatting

C/C++ files are formatted with `clang-format` after every `write` or `edit` tool call. If `clang-format` is not installed, this step is skipped silently. Formatting uses your project's `.clang-format` when present.

### Commands

- `/cpp-setup` — Check and report C/C++ toolchain availability

### Context Injection

Adds C++ guidelines to the system prompt:

- Prefer smart pointers over raw new/delete
- Ensure `compile_commands.json` exists for clangd
- Use minimal diffs when editing

### Skills

- `cpp-setup` — Guided environment setup walkthrough

## Required Tools

All tools are optional; each feature reports clearly when its tool is missing.

| Tool | macOS | Debian/Ubuntu | Purpose |
|------|-------|---------------|---------|
| `clang-format` | `brew install llvm` | `apt install clang-format` | Formatting |
| `clang-tidy` | `brew install llvm` | `apt install clang-tidy` | Linting |
| `clangd` | `brew install llvm` | `apt install clangd` | Hover and definition tools; editor language server |
| `cppcheck` | `brew install cppcheck` | `apt install cppcheck` | Static analysis |
| `cmake` | `brew install cmake` | `apt install cmake` | Compilation database generation and project builds |
| `ctest` | Included with CMake | Included with CMake | Project test execution |
| `bear` | `brew install bear` | `apt install bear` | `compile_commands.json` for Make projects |

On macOS, Homebrew's LLVM is keg-only. Add `$(brew --prefix llvm)/bin` to your `PATH`.

## Project Structure

```text
pi-cpp-lsp/
├── extensions/
│   ├── index.ts        # Pi extension (tools, commands, hooks)
│   └── lib/            # Compilation database, clangd, and build support
├── skills/
│   └── cpp-setup/
│       └── SKILL.md    # Guided setup skill
├── tests/
│   ├── *.test.ts       # Automated tool and integration tests
│   └── sample_test.cpp # Sample file for manual testing
└── package.json        # Pi package manifest
```

## Development

```bash
npm install
npm run typecheck
npm test
pi -e ./            # load the local checkout into pi
```

Tests run on Node.js 24. Integration tests use local C/C++ tools when installed; tests requiring unavailable tools are skipped.

## Credits

Based on the [cpp-lsp Claude Code plugin](https://github.com/zircote/cpp-lsp) by Robert Allen ([@zircote](https://github.com/zircote)), ported to a pi extension. The original MIT license notice is kept in [NOTICE](NOTICE).

## License

Copyright 2026 Martin Juul Christiansen. Licensed under the [Apache License 2.0](LICENSE).
