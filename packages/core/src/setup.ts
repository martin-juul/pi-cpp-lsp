import type { Exec } from "./exec.ts";
import { isSupportedCmake, probeCmake, supportsPresets, type CmakeVersion } from "./project/configure.ts";
import { setupFeatureLines, type ToolchainServiceOptions } from "./toolchain.ts";
import { harness } from "./harness.ts";

/** The clangd major version that first supports each navigation feature (see navigation.ts). */
const CLANGD_FEATURES: { feature: string; major: number }[] = [
  { feature: "incoming calls (cpp_calls)", major: 12 },
  { feature: "type hierarchy (cpp_types)", major: 16 },
  { feature: "outgoing calls (cpp_calls)", major: 21 },
];

/** Setup lines for the navigation features the clangd `--version` line supports. */
export function clangdFeatures(versionLine: string): string[] {
  const match = versionLine.match(/clangd version (\d+)/);
  if (!match) return ["  ? navigation features: could not read the clangd version"];
  const major = Number(match[1]);
  return CLANGD_FEATURES.map(({ feature, major: needed }) =>
    major >= needed ? `  ✓ ${feature}` : `  ✗ ${feature.replace(/ \(.*\)$/, "")}: needs clangd ${needed} or newer`);
}

/** Setup lines for the CMake features this version supports. */
export function cmakeFeatures(cmake: CmakeVersion): string[] {
  return [
    isSupportedCmake(cmake)
      ? "  ✓ project model (briefing, drift, managed build)"
      : "  ✗ project model: needs CMake 3.14 or newer; CMake projects are treated like non-CMake ones",
    supportsPresets(cmake) ? `  ✓ presets (${harness.presetCommand})` : "  ✗ presets: need CMake 3.19 or newer",
  ];
}

/** The programs the setup check looks for, how it asks each for its version, and how to install it. */
export const SETUP_TOOLS: { name: string; check: string; install: string }[] = [
  { name: "clangd", check: "clangd --version", install: "brew install llvm" },
  { name: "clang-format", check: "clang-format --version", install: "brew install llvm" },
  { name: "clang-tidy", check: "clang-tidy --version", install: "brew install llvm" },
  { name: "cppcheck", check: "cppcheck --version", install: "brew install cppcheck" },
  { name: "cmake", check: "", install: "brew install cmake" },
  { name: "ctest", check: "ctest --version", install: "brew install cmake" },
  { name: "ninja", check: "ninja --version", install: "brew install ninja (optional; the managed build falls back to Unix Makefiles)" },
];

/**
 * The setup report: each program's version or how to install it, the navigation features of the
 * clangd version, the CMake thresholds, and the default compiler's and clangd's C++ features side by side.
 */
export async function setupLines(exec: Exec, toolchain?: Pick<ToolchainServiceOptions, "clangd" | "clangdTimeoutMs">): Promise<string[]> {
  const results: string[] = [];
  for (const tool of SETUP_TOOLS) {
    if (tool.name === "cmake") {
      const cmake = await probeCmake(exec);
      if (cmake) results.push(`✓ cmake: ${cmake.text}`, ...cmakeFeatures(cmake));
      else results.push(`✗ cmake: not found — install with: ${tool.install}`);
      continue;
    }
    try {
      const r = await exec("sh", ["-c", tool.check], { timeout: 5000 });
      if (r.code === 0) {
        const version = r.stdout.trim().split("\n")[0];
        results.push(`✓ ${tool.name}: ${version}`);
        if (tool.name === "clangd") results.push(...clangdFeatures(version));
      } else {
        results.push(`✗ ${tool.name}: not found — install with: ${tool.install}`);
      }
    } catch {
      results.push(`✗ ${tool.name}: not found — install with: ${tool.install}`);
    }
  }

  // Which C++ features the default compiler and clangd support, side by side.
  results.push(...await setupFeatureLines(exec, toolchain));
  return results;
}
