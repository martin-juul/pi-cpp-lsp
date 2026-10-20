# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.0]: https://github.com/martin-juul/pi-cpp-lsp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/martin-juul/pi-cpp-lsp/releases/tag/v1.0.0
