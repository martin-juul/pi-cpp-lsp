---
name: cpp-setup
description: Set up C/C++ development environment with clangd, clang-format, clang-tidy, cppcheck, and cmake.
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
   - **openSUSE:** `sudo zypper install llvm clangd clang-format clang-tidy`
   - **Arch:** `sudo pacman -S llvm clang`

2. **Install static analysis tools**

   ```bash
   # cppcheck
   brew install cppcheck        # macOS
   sudo apt install cppcheck    # Ubuntu/Debian
   sudo zypper install cppcheck # openSUSE

   # CMake (for compile_commands.json generation)
   brew install cmake           # macOS
   sudo apt install cmake       # Ubuntu/Debian
   sudo zypper install cmake    # openSUSE
   ```

3. **Verify installation**

   ```bash
   clangd --version
   clang-format --version
   clang-tidy --version
   cppcheck --version
   cmake --version
   ```

4. **Generate compile_commands.json**

   For CMake projects:
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

5. **Configure project defaults** (optional)

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
- Without `compile_commands.json`, clangd cannot resolve includes or provide go-to-definition.
- The `cpp_compile` tool uses `-fsyntax-only` which is faster but skips linking — linker errors won't be caught.

## Verification

- `clangd --version` exits 0
- `compile_commands.json` exists in project root
- `cpp_check` and `cpp_compile` tools work on a sample `.cpp` file
