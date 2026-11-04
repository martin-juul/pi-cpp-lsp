import { featureLabels, type TargetProfile } from "./toolchain.ts";

/**
 * The line navigation results end with when some target's build compiler supports features clangd
 * lacks: clangd cannot parse code that uses them, so its index can miss usages there. Names the
 * features across all gap targets; undefined when there are none.
 */
export function navigationGapNote(gaps: readonly TargetProfile[]): string | undefined {
  if (gaps.length === 0) return undefined;
  return `[clangd lacks ${featureLabels(gaps.flatMap(profile => profile.clangdLacks))}, which the build compiler supports; usages in code that uses them may be missing]`;
}

/**
 * The line hover, definition and clang-tidy results carry for a file in a gap target. clang-tidy
 * usually comes from the same LLVM install as clangd, so clangd's missing features stand for all
 * clang-based tools. Undefined when the file has no gap profile.
 */
export function clangToolsGapNote(profile: TargetProfile | undefined): string | undefined {
  if (!profile) return undefined;
  return `[clang-based tools lack ${featureLabels(profile.clangdLacks)}, which the build compiler supports for target ${profile.target}; results for code that uses them may be wrong]`;
}
