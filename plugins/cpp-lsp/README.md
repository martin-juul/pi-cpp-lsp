# cpp-lsp for Claude Code

C/C++ support for Claude Code: a CMake project model, clangd navigation and rename, builds and tests, C++ feature detection, and notes after each edit. It is the Claude Code plugin of [pi-cpp-lsp](https://github.com/martin-juul/pi-cpp-lsp), built on the same core.

## Install

```bash
claude plugin marketplace add martin-juul/pi-cpp-lsp
claude plugin install cpp-lsp@pi-cpp-lsp
```

The plugin needs `node` on your `PATH`. The C/C++ tools it uses (clangd, CMake, clang-format, clang-tidy and others) are optional; `/cpp-lsp:cpp-setup` shows which ones it found.

## Use

1. Open a CMake project in Claude Code and run `/cpp-lsp:trust` once. The plugin runs nothing in a CMake project until then, because configuring it runs the project's CMake code.
2. Work as usual. Claude gets a project briefing with the first prompt, a note after each edit (formatting, drift, owning targets, diagnostics, and the build compiler's verdict when clangd can't parse newer C++), drift notes after shell commands, and the `cpp_*` tools.

Commands:

- `/cpp-lsp:trust` enables the plugin for the current CMake project.
- `/cpp-lsp:cpp-setup` checks the toolchain.
- `/cpp-lsp:cpp-preset [name]` lists the configure presets, or switches to one.

State lives in `${XDG_CACHE_HOME:-~/.cache}/cpp-lsp-claude/<hash>/`, never in your project. The full documentation is in the [pi-cpp-lsp README](https://github.com/martin-juul/pi-cpp-lsp#claude-code).
