# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-11-03

### Added

- CMake project model: in a CMake project, the extension configures a managed build directory in the background and reads the CMake File API (CMake 3.14 or newer). Configuring runs the project's CMake code, so it only happens when pi trusts the project; an untrusted project gets a one-time notification and no project support.
- Session briefing on the first prompt, with the preset, configuration, generator, targets, C++ standards, dependencies, open drift findings and notes. It is sent again after compaction and after a preset change.
- Drift notes after `write`, `edit` and `bash`. They name source files that belong to no target, with the likely owner and the `CMakeLists.txt` line to edit, and listed sources that are missing on disk. Files referenced in CMake but not built in this configuration are listed as information, never as drift.
- Post-edit note after `write` and `edit`: clang-format result, drift, the owning targets and their C++ standard, and clangd diagnostics (errors first, at most 20, "pending" when clangd does not answer in time).
- `cpp_project` tool with `overview`, `targets`, `target`, `owner`, `refresh` and `presets` actions. `presets` only lists the configure presets; switching stays with `/cpp-preset`.
- `cpp_run` tool to run a built executable target with arguments.
- `/cpp-preset` command to list configure presets and switch between them (CMake 3.19 or newer). The choice is remembered per project.
- Managed clangd with a background index, and the `cpp_references`, `cpp_symbols`, `cpp_calls` and `cpp_types` navigation tools.
- `cpp_rename` tool that renames a symbol across the project in one transaction, or refuses and changes nothing.
- Managed cache in `${XDG_CACHE_HOME:-~/.cache}/pi-cpp-lsp/<hash>/` for build directories, the clangd index and the remembered preset. Nothing is written into the project tree.
- `/cpp-setup` checks Ninja, reports which navigation features the installed clangd supports, and checks CMake against the 3.14 (project model) and 3.19 (presets) thresholds.

### Changed

- **Behavior change:** when `build_dir` is omitted and the project model is ready, `cpp_build`, `cpp_test`, `cpp_compile`, `cpp_check`, `cpp_hover` and `cpp_definition` use the managed build directory instead of `build/` or the auto-detected compilation database. Each result names the directory it used. Pass `build_dir` to keep using your own build directory.
- In CMake sessions, the fixed C++ prompt guidelines are replaced by a rule to write code valid for the owning target's C++ standard.
- CI installs Ninja and clangd 21 from apt.llvm.org, so every navigation test runs.

## [1.1.0] - 2026-10-20

### Added

- Compilation-database-aware syntax checks and explicit build-directory selection for clang-tidy.
- `cpp_hover` and `cpp_definition` tools backed by a managed clangd connection.
- `cpp_build` and `cpp_test` tools for CMake builds and CTest execution.
- Automated tests for project checks, language-server requests, and build/test execution.

### Changed

- Standalone syntax checks use C17 for `.c` files and C++17 for C++ files.
- Compiler and analyzer failures now return error tool results.
- CI installs the native toolchain so real clangd integration tests run; publishing also runs the test suite.

## [1.0.0] - 2026-10-15

### Added

- `cpp_check`, `cpp_compile`, `cpp_format`, and `cpp_gen_compdb` tools.
- Auto-formatting of C/C++ files with clang-format after `write` and `edit`.
- `/cpp-setup` toolchain check command and `cpp-setup` skill.
- C++ guidelines injected into the system prompt.

[Unreleased]: https://github.com/martin-juul/pi-cpp-lsp/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/martin-juul/pi-cpp-lsp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/martin-juul/pi-cpp-lsp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/martin-juul/pi-cpp-lsp/releases/tag/v1.0.0
