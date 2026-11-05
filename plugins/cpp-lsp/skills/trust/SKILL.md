---
name: trust
description: Enable the cpp-lsp plugin for the current CMake project, which lets it configure the project with CMake and run its compiler and clangd.
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/server/trust.mjs *)
---

# Enable cpp-lsp for this project

cpp-lsp runs nothing in a CMake project until the user enables it, because configuring the project runs the project's own CMake code. The user just ran `/cpp-lsp:trust`, and this is the result:

!`node ${CLAUDE_PLUGIN_ROOT}/server/trust.mjs "${CLAUDE_PROJECT_DIR}" "${CLAUDE_PLUGIN_DATA}"`

Tell the user the result above in one or two sentences. Do not call any tool, and do not try to enable the project another way.
