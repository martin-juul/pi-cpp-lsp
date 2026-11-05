---
name: cpp-preset
description: List the project's CMake configure presets, or switch to one and reconfigure.
argument-hint: "[preset]"
disable-model-invocation: true
---

# CMake configure presets

The user ran `/cpp-lsp:cpp-preset` with this argument (it may be empty): `$ARGUMENTS`

Call the `cpp_preset` tool of the cpp-lsp plugin once:

- When the argument above is empty, call it without `name`; it lists the presets.
- Otherwise call it with `name` set to the argument exactly; it switches the project to that preset and reconfigures.

Then show the user the tool's answer. Do not edit CMake files or run cmake yourself.
