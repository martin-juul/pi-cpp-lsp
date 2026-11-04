# pi-cpp-lsp

[![CI](https://github.com/martin-juul/pi-cpp-lsp/actions/workflows/ci.yml/badge.svg)](https://github.com/martin-juul/pi-cpp-lsp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pi-cpp-lsp.svg)](https://www.npmjs.com/package/pi-cpp-lsp)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Pi Package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![C++](https://img.shields.io/badge/C++-00599C?logo=cplusplus&logoColor=white)](https://isocpp.org/)

A [pi](https://pi.dev) extension providing C/C++ development support: formatting, static analysis, project-aware compile checks, clangd navigation, and CMake builds and tests.

In a CMake project, the extension configures its own build directory, reads the CMake File API, and tells pi how the project is built: targets, C++ standards, dependencies and source files that are not registered in any `CMakeLists.txt`. For every target on C++11 or newer, it also tells pi which C++ features the build compiler and clangd actually support. Navigation tools use a clangd background index, so pi can find references, callers and derived classes instead of using grep.

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

It lists each tool and its version. It also shows which navigation features your clangd supports and whether your CMake is new enough for the project model and for presets (see [Version Requirements](#version-requirements)).

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
| `cpp_run` | Run a built executable target with arguments |
| `cpp_project` | Query the CMake project model: overview, targets, one target, a file's owner, presets, or refresh |
| `cpp_references` | Find all references to a symbol across the project |
| `cpp_symbols` | Search symbols across the project, or outline one file |
| `cpp_calls` | List the callers (incoming) or callees (outgoing) of a function |
| `cpp_types` | List the base classes (supertypes) or derived classes (subtypes) of a type |
| `cpp_rename` | Rename a symbol across the project in one transaction |

### Project Model

When the session's working directory is inside a CMake project, the extension finds the source root. That is the topmost directory with a `CMakeLists.txt` in an unbroken chain of parent directories, stopping at the git top level. The extension configures the project in the background, in a build directory it manages (see [Managed Cache](#managed-cache)). It never configures into your own `build/` directory and never edits `CMakeLists.txt`.

Configuring runs the project's CMake code, so it only happens in projects pi trusts (pi's project trust, described in pi's security documentation). In a project pi does not trust, the extension does not run CMake, the managed clangd, or its git and CTest drift checks. The session behaves like a non-CMake one, and a one-time notification says why. To enable project support, trust the project with `/trust` and restart pi, or start pi with `--approve`. pi treats a folder without project-local pi resources (such as `.pi/settings.json` or `.pi/extensions`) as trusted.

- **Session briefing.** The first prompt of a session carries a project briefing: the preset, configuration and generator; a table of targets with their kind, directories, C++ standard and dependencies; open drift findings; and notes. Large projects get a shorter summary, and `cpp_project overview` returns the full briefing. The briefing is sent again after a context compaction or a preset change.
- **Drift notes.** After each `write`, `edit` and `bash` tool call, the extension checks the project again. If CMake files changed, it reconfigures first. A drift note lists new findings and findings that no longer hold. A source file (`.c`, `.cc`, `.cpp`, `.cxx`) in no target is reported with its likely owning target and the `CMakeLists.txt` line to edit. A source listed in CMake but missing on disk is reported with the line that lists it. The extension never edits build files; pi makes the edit.
- **Not built in this configuration.** Source files that are named in a `CMakeLists.txt` but not built in the active configuration, for example behind an `option()` or a platform check, are listed as information in the briefing. They are never reported as drift.
- **Post-edit note.** After a `write` or `edit` of a C/C++ file, one note reports the clang-format result, drift, the owning targets and the C++ standard the file must stay valid for, and clangd's diagnostics for the file. Errors come first, at most 20 diagnostics are listed, and the note reads "diagnostics pending" when clangd does not answer in time. When clangd cannot parse features the build compiler supports, the build compiler checks the file instead (see [C++ Features](#c-features)).
- **Presets.** With a `CMakePresets.json` or `CMakeUserPresets.json`, the extension uses the first configure preset whose name mentions `debug` or `dev`, or else the first one. `/cpp-preset` lists the presets and `/cpp-preset <name>` switches to one and reconfigures. The choice is remembered per project. Without a preset, the managed build uses `CMAKE_BUILD_TYPE=Debug`.
- **Guidelines.** In a CMake session, the fixed guidelines below are replaced by one rule: write code that is valid for the C++ standard of the target that owns the file.

`cpp_project` answers questions about the model:

- `overview` returns the full briefing.
- `targets` lists every project target with its kind, standard, directories and dependencies.
- `target` (with `name`) returns one target's sources, include directories, defines, standard, dependencies and artifacts.
- `owner` (with `path`) returns the targets that build a file and the standard it must stay valid for.
- `refresh` reconfigures now and returns the result.
- `presets` lists the configure presets, marking the active and the default one. It only lists them; switching is the user's `/cpp-preset <name>` command.

While a configure is running, `cpp_project` says so. After a failed configure, it answers from the last successful model and says the answer may be stale.

Outside a CMake project, in a project pi does not trust, or with CMake older than 3.14, the extension runs without the project model: no briefing, no drift notes, and `cpp_hover` and `cpp_definition` use whatever compilation database exists. For an untrusted CMake project or one whose CMake is too old, a one-time notification says why, and `cpp_project` reports the reason.

#### Default Build Directory (Behavior Change)

When you omit `build_dir` and the project model is ready, `cpp_build`, `cpp_test`, `cpp_compile`, `cpp_check`, `cpp_hover` and `cpp_definition` now use the managed build directory instead of `build/` or the auto-detected compilation database. Each result names the directory or compilation database it used. Pass `build_dir` to use your own build directory. Outside a CMake project, or before the model is ready, the previous defaults apply.

### C++ Features

For every target on C++11 or newer, the extension asks the build compiler, with that target's own compile command, which features of the C++11 to C++26 standards it supports, up to the target's standard. It asks clangd the same question. The list covers the features that have feature-test macros, such as lambdas, `std::optional`, concepts, `std::expected`, contracts and static reflection.

- **Briefing.** The session briefing has a "C++ features" section. For each group of targets with the same results it names the compiler and lists every available feature by standard, the features that need an extra flag (such as GCC's `-freflection` for reflection), and the features clangd lacks. A large project gets one summary line per group; `cpp_project overview` keeps the full list. If the check is still running when the briefing goes out, the results follow in the next update.
- **When clangd is behind.** Compilers and clangd do not support the same features. GCC 16, for example, compiles C++26 contracts, and reflection with `-freflection`, but clangd 23 rejects both and reports errors on correct code. In a target where the build compiler supports features clangd lacks:
  - After a `write` or `edit` that clangd reports errors for, the build compiler syntax-checks the file, and its diagnostics replace clangd's in the post-edit note, which names the compiler. A header is compiled on its own with its target's flags. If the compiler cannot check the file within 15 seconds, the note keeps clangd's diagnostics and the reason goes to the log. Edits clangd finds clean cost nothing extra.
  - After `cpp_rename`, the build compiler checks the targets the rename can affect (see [Navigation](#navigation)).
- **What cannot be done goes to the log.** Features clangd lacks, targets that could not be measured, and files the compiler could not check are written to the project's log in the managed cache (see [Managed Cache](#managed-cache)). Tool results carry no notes that would repeat on every call. The briefing lists the features clangd lacks once.
- **Lifetime.** Results are measured in the background when the project model is ready and again when `compile_commands.json` changes. They are kept in memory for the session only.

Measuring runs the project's compiler, which only happens in projects pi trusts, like configuring. A target on C++98/03 or on the compiler's default standard is not measured.

### Project-Aware Checks

`cpp_compile` uses `compile_commands.json` when available, preserving the source file's include paths, defines, language flags, and working directory. Use `build_dir` to select a custom compilation database directory. Explicit `compiler` and `standard` options override the database settings. Without a database, standalone checks use C17 for `.c` files and C++17 for C++ files.

`cpp_check` also accepts `build_dir` to point clang-tidy at the project's compilation database. Compilation checks remain syntax-only; use `cpp_build` to catch linker errors.

Database checks currently support direct GCC/Clang commands. The module-scanning flags CMake 3.28 and newer adds to C++20-or-newer targets are removed, so a source that imports modules still fails its check. Compiler wrappers, other response files, MSVC commands, and module/plugin or compiler pass-through flags are reported as unsupported. A malformed database or missing source entry produces an error rather than silently using standalone flags.

### Symbol Navigation

`cpp_hover` and `cpp_definition` accept `file`, `line`, and `column`, plus an optional `build_dir` for clangd's compilation database. Positions are **1-based**, with columns counted in UTF-16 code units. Results reflect files saved on disk. Clangd starts on demand and stops when the session shuts down.

For example, use `cpp_hover` with `{"file":"src/main.cpp","line":12,"column":5}` to inspect the symbol at that position. clangd needs accurate project flags to resolve project headers and types.

### Navigation

In a CMake project, the extension runs one clangd per session against the managed compilation database, with a background index. It starts when the project model is ready and restarts when `compile_commands.json` changes. The index is stored in the managed cache, not in the project tree.

- `cpp_references` takes `file`, `line` and `column`, and lists every reference, including the declaration and definition.
- `cpp_symbols` takes `query` to search the whole project by name, or `file` to outline one file with members nested under their class.
- `cpp_calls` takes a position and `direction`: `incoming` (callers) or `outgoing` (callees).
- `cpp_types` takes a position and `direction`: `supertypes` (base classes) or `subtypes` (derived classes).
- `cpp_rename` takes a position and `new_name`, and edits every file that uses the symbol. The rename waits for the index. The whole rename is refused, with nothing changed, when clangd cannot rename the symbol, the index is still building, a file changed during the rename, or an edit would land outside the project or in a build or dependency directory. The result lists each changed file with its clangd diagnostics. In a project where the build compiler supports C++ features clangd lacks, clangd's index can miss uses inside code that uses them. The build compiler then syntax-checks the affected targets clangd is behind on, within 60 seconds, and the result lists the errors it found and says the build may be broken. Files it could not check are written to the log, and the result says some were not checked. The rename is not undone.

These tools need the project model and always use the managed, indexed clangd. They return an error outside a CMake project or while the first configure is running. Positions are 1-based UTF-16, as for `cpp_hover`. Results are capped at 100 entries (300 for a file outline). On first use in a large project the index may still be building; results then end with a note that they may be incomplete. A feature your clangd does not support returns "not supported by this clangd version" with the version it needs.

### Building and Testing

In a CMake project the managed build directory is configured for you. Elsewhere, configure first, using `cpp_gen_compdb` or your project's normal CMake configuration command. Then:

- `cpp_build` accepts `build_dir` (default: the managed build directory when the project model is ready, otherwise `build`), optional `target`, `config`, and `parallel`.
- `cpp_test` accepts `build_dir` (same default), optional test-name `regex`, `config`, and `parallel`. Build test executables before running it. Selecting no tests is reported as a failure.
- `cpp_run` accepts an executable `target`, optional `args`, and `cwd` (default: the CMake source root). It finds the executable in the project model, so build the target first. It needs the project model.
- All three tools accept `timeout_ms` (default 120000, maximum 600000), support cancellation, and report command output, exit status and the build directory used. Large output is saved to a temporary log.

### Auto-Formatting

C/C++ files are formatted with `clang-format` after every `write` or `edit` tool call. If `clang-format` is not installed, this step is skipped silently. Formatting uses your project's `.clang-format` when present.

### Commands

- `/cpp-setup` — Check and report C/C++ toolchain availability, the navigation features your clangd supports, your CMake version against the project-model and preset thresholds, and, per standard, which C++ features the default compiler (`$CXX`, else `c++`) and clangd support
- `/cpp-preset [name]` — List the CMake configure presets, or switch to one and reconfigure

### Context Injection

Outside CMake projects, adds C++ guidelines to the system prompt:

- Prefer smart pointers over raw new/delete
- Ensure `compile_commands.json` exists for clangd
- Use minimal diffs when editing

In CMake projects, the guideline is to write code valid for the owning target's C++ standard, and the session briefing is added to the first prompt (see [Project Model](#project-model)).

### Managed Cache

The extension keeps all of its state outside the project tree, in `${XDG_CACHE_HOME:-~/.cache}/pi-cpp-lsp/<hash>/`. The hash is derived from the project's real source-root path. The directory holds:

- `builds/` — one managed build directory per preset (`default` without a preset), with `compile_commands.json` and the CMake File API replies
- the clangd background index, in `.cache/clangd/index` inside the managed build directory
- `state.json` — the remembered preset
- `pi-cpp-lsp.log` — what the extension could not do: features clangd lacks, targets it could not measure, files the compiler could not check

Nothing is written into the project tree. The cache is safe to delete at any time; the next session configures again. The first configure of a project that uses FetchContent downloads its dependencies again, into the managed build directory.

### Skills

- `cpp-setup` — Guided environment setup walkthrough

## Required Tools

All tools are optional; each feature reports when its tool is missing.

| Tool | macOS | Debian/Ubuntu | Purpose |
|------|-------|---------------|---------|
| `clang-format` | `brew install llvm` | `apt install clang-format` | Formatting |
| `clang-tidy` | `brew install llvm` | `apt install clang-tidy` | Linting |
| `clangd` | `brew install llvm` | `apt install clangd` | Hover, definition, navigation, rename and post-edit diagnostics |
| `cppcheck` | `brew install cppcheck` | `apt install cppcheck` | Static analysis |
| `cmake` | `brew install cmake` | `apt install cmake` | Project model, managed builds, compilation database generation |
| `ctest` | Included with CMake | Included with CMake | Project test execution |
| `ninja` | `brew install ninja` | `apt install ninja-build` | Preferred generator for the managed build (optional) |
| `bear` | `brew install bear` | `apt install bear` | `compile_commands.json` for Make projects |

On macOS, Homebrew's LLVM is keg-only. Add `$(brew --prefix llvm)/bin` to your `PATH`.

### Version Requirements

| Feature | Needs |
|---------|-------|
| Project model, briefing, drift, managed build | CMake 3.14 or newer (File API codemodel v2) |
| Configure presets | CMake 3.19 or newer; older versions ignore preset files and say so in the briefing |
| References, symbol search, rename | clangd with a background index |
| Incoming calls (`cpp_calls`) | clangd 12 or newer |
| Type hierarchy (`cpp_types`) | clangd 16 or newer |
| Outgoing calls (`cpp_calls`) | clangd 21 or newer |
| C++ feature lists and the compiler check when clangd is behind | The project model, and a GCC or Clang compiler driver in `compile_commands.json` |

The managed build uses the Ninja generator when `ninja` is installed, otherwise Unix Makefiles, unless the preset names a single-configuration generator. An existing managed build directory keeps the generator it was created with.

Ubuntu 24.04 ships clangd 18, which has no outgoing calls. For clangd 21 or newer on Debian or Ubuntu, use the [apt.llvm.org](https://apt.llvm.org) packages (for example `clangd-21`) and put that `clangd` first on your `PATH`.

## Project Structure

```text
pi-cpp-lsp/
├── extensions/
│   ├── index.ts        # Pi extension (tools, commands, hooks)
│   └── lib/            # Compilation database, clangd, navigation, rename, diagnostics and build support
│       └── project/    # CMake root discovery, managed configure, File API model, drift and briefing
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

Tests run on Node.js 24. Integration tests use local C/C++ tools when installed; tests requiring unavailable tools, or a clangd feature the local clangd lacks, are skipped. CI installs Ninja and clangd 21 from apt.llvm.org, so no navigation test is skipped there.

## License

Copyright 2026 Martin Juul Christiansen. Licensed under the [Apache License 2.0](LICENSE).
