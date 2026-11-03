---
name: cpp-setup
description: Set up C/C++ development environment with clangd, clang-format, clang-tidy, cppcheck, cmake, and ninja.
---

# C/C++ Development Environment Setup

## When to Use

Use when starting C/C++ work in a new environment, when clangd can't find headers, or when the user asks to set up the C++ toolchain.

## Procedure

1. **Check for LLVM/clangd**

   ```bash
   clangd --version
   clang-format --version
   clang-tidy --version
   ```

   If missing, install:
   - **macOS:** `brew install llvm` then add to PATH:
     ```bash
     echo 'export PATH="/opt/homebrew/opt/llvm/bin:$PATH"' >> ~/.zshrc
     source ~/.zshrc
     ```
   - **Ubuntu/Debian:** `sudo apt install llvm clangd clang-format clang-tidy`
     (Ubuntu 24.04 ships clangd 18; see step 2 for a newer clangd)
   - **openSUSE:** `sudo zypper install llvm clangd clang-format clang-tidy`
   - **Arch:** `sudo pacman -S llvm clang`

2. **Check the clangd version**

   Navigation features depend on the clangd version. Check it with `clangd --version`, or run `/cpp-setup`, which lists the supported features.

   | Feature | clangd |
   |---------|--------|
   | References, symbol search, rename (`cpp_references`, `cpp_symbols`, `cpp_rename`) | background index (any recent clangd) |
   | Incoming calls (`cpp_calls`) | 12 or newer |
   | Type hierarchy (`cpp_types`) | 16 or newer |
   | Outgoing calls (`cpp_calls` with `direction: outgoing`) | 21 or newer |

   On Debian/Ubuntu, get clangd 21 or newer from [apt.llvm.org](https://apt.llvm.org):
   ```bash
   wget https://apt.llvm.org/llvm.sh
   sudo bash llvm.sh 21          # installs clang-21, clangd-21 and related packages
   export PATH="/usr/lib/llvm-21/bin:$PATH"   # put clangd 21 first; add this to your shell profile
   ```
   Homebrew's `llvm` is usually current on macOS.

3. **Install static analysis tools**

   ```bash
   # cppcheck
   brew install cppcheck        # macOS
   sudo apt install cppcheck    # Ubuntu/Debian
   sudo zypper install cppcheck # openSUSE

   # CMake (project model, managed builds, compile_commands.json generation)
   brew install cmake           # macOS
   sudo apt install cmake       # Ubuntu/Debian
   sudo zypper install cmake    # openSUSE

   # Ninja (optional; preferred generator for the managed build)
   brew install ninja           # macOS
   sudo apt install ninja-build # Ubuntu/Debian
   sudo zypper install ninja    # openSUSE
   ```

   The CMake project model (session briefing, drift notes, managed build, navigation tools) needs CMake 3.14 or newer. Configure presets need CMake 3.19 or newer.

4. **Verify installation**

   ```bash
   clangd --version
   clang-format --version
   clang-tidy --version
   cppcheck --version
   cmake --version
   ninja --version
   ```

5. **Generate compile_commands.json** (only outside CMake projects, or for your own build directory)

   In a CMake project the extension configures its own managed build directory under `${XDG_CACHE_HOME:-~/.cache}/pi-cpp-lsp/` and needs no `compile_commands.json` in the project. To use your own build directory instead, generate `compile_commands.json` in it and pass `build_dir` to the tools:
   ```bash
   cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -B build
   ln -s build/compile_commands.json .
   ```

   For Make projects:
   ```bash
   brew install bear            # macOS
   sudo apt install bear        # Ubuntu/Debian
   sudo zypper install bear     # openSUSE (or `sudo zypper install bear` from OBS)
   bear -- make
   ```

6. **Configure project defaults** (optional)

   Create `.clang-format`:
   ```yaml
   BasedOnStyle: Google
   IndentWidth: 4
   ColumnLimit: 100
   ```

   Create `.clang-tidy`:
   ```yaml
   Checks: 'clang-analyzer-*,modernize-*,performance-*,bugprone-*'
   ```

## Pitfalls

- On macOS, LLVM tools are keg-only — you must add `/opt/homebrew/opt/llvm/bin` to PATH manually.
- Without accurate compilation flags, clangd may fail to resolve project headers and symbols. Outside CMake projects, generate `compile_commands.json` and pass `build_dir` when using a custom build location.
- In CMake projects, tools called without `build_dir` use the managed build directory once the project model is ready, not `build/`. Each result names the directory it used.
- If `cpp_calls` with `direction: outgoing` or `cpp_types` reports "not supported by this clangd version", install a newer clangd (step 2).
- Navigation results right after the session starts may be incomplete while clangd's background index builds; the result says so.
- The `cpp_compile` tool uses `-fsyntax-only`, which is faster but skips linking, so it does not catch linker errors.
- Use `cpp_build` after configuration to catch linker errors, then `cpp_test` to run CTest tests.
- `cpp_hover` and `cpp_definition` use saved files and 1-based line/column positions (UTF-16 columns).

## Verification

- `clangd --version` exits 0
- Outside CMake projects, `compile_commands.json` exists in project root
- `cpp_check` and `cpp_compile` tools work on a sample `.cpp` file
- `/cpp-setup` marks every clangd feature and CMake threshold you need as supported
- `cpp_hover` and `cpp_definition` resolve a known project symbol
- In a CMake project, `cpp_project` with `action: overview` returns the project briefing, and `cpp_references` finds a known symbol's uses
- For CMake projects with tests, `cpp_build` and `cpp_test` succeed
