---
name: cpp-setup
description: Check the C/C++ toolchain (clangd, clang-format, clang-tidy, cppcheck, cmake, ctest, ninja) and which C++ features the default compiler and clangd support.
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/server/setup.mjs)
---

# C/C++ toolchain check

The user ran `/cpp-lsp:cpp-setup`. This is the toolchain report:

!`node ${CLAUDE_PLUGIN_ROOT}/server/setup.mjs`

Show the user the report above unchanged, in a code block. After it, name in one sentence each missing tool with its install command from the report, if any is missing. Do not run any other command.
