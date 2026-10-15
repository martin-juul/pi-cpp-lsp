# pi-cpp-lsp

[![CI](https://github.com/martin-juul/pi-cpp-lsp/actions/workflows/ci.yml/badge.svg)](https://github.com/martin-juul/pi-cpp-lsp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pi-cpp-lsp.svg)](https://www.npmjs.com/package/pi-cpp-lsp)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Pi Package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![C++](https://img.shields.io/badge/C++-00599C?logo=cplusplus&logoColor=white)](https://isocpp.org/)

A [pi](https://pi.dev) extension providing C/C++ development support: auto-formatting, linting, compile checks, and `compile_commands.json` generation for clangd.

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
| `cpp_compile` | Compile-check with clang++/g++ (`-fsyntax-only -Wall -Wextra`) |
| `cpp_format` | Format with clang-format |
| `cpp_gen_compdb` | Generate `compile_commands.json` via CMake or Bear |

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
| `clangd` | `brew install llvm` | `apt install clangd` | Language server for your editor |
| `cppcheck` | `brew install cppcheck` | `apt install cppcheck` | Static analysis |
| `cmake` | `brew install cmake` | `apt install cmake` | `compile_commands.json` generation |
| `bear` | `brew install bear` | `apt install bear` | `compile_commands.json` for Make projects |

On macOS, Homebrew's LLVM is keg-only. Add `$(brew --prefix llvm)/bin` to your `PATH`.

## Project Structure

```text
pi-cpp-lsp/
├── extensions/
│   └── index.ts        # Pi extension (tools, commands, hooks)
├── skills/
│   └── cpp-setup/
│       └── SKILL.md    # Guided setup skill
├── tests/
│   └── sample_test.cpp # Sample file for manual testing
└── package.json        # Pi package manifest
```

## Development

```bash
npm install
npm run typecheck
pi -e ./            # load the local checkout into pi
```

## Credits

Based on the [cpp-lsp Claude Code plugin](https://github.com/zircote/cpp-lsp) by Robert Allen ([@zircote](https://github.com/zircote)), ported to a pi extension. The original MIT license notice is kept in [NOTICE](NOTICE).

## License

Copyright 2026 Martin Juul Christiansen. Licensed under the [Apache License 2.0](LICENSE).
