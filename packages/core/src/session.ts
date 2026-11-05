import { ManagedClangd, type ClangdOptions } from "./clangd.ts";
import { postEditNote, resolveToolPath, type PostEditOptions } from "./diagnostics.ts";
import type { Exec } from "./exec.ts";
import { projectLog, type Log } from "./log.ts";
import { ProjectService, type ProjectServiceOptions, type RunMessage } from "./project/session.ts";
import { ToolchainService, type ToolchainServiceOptions } from "./toolchain.ts";

/** System-prompt guidelines outside a CMake project. */
export const FIXED_GUIDELINES = [
  "Prefer smart pointers over raw new/delete in C++ code.",
  "Make sure compile_commands.json exists; clangd reads each file's compile flags from it.",
  "Use minimal diffs when editing C/C++ files.",
];
/** In a CMake project the model drives the standard guidance. */
export const STANDARD_GUIDELINE =
  "Write C/C++ code that is valid for the C++ standard of the target that owns the file you edit; the project briefing lists each target's standard.";

export interface CppSessionOptions extends Pick<ProjectServiceOptions, "notify" | "waitMs" | "trusted" | "untrusted"> {
  /** The session's working directory; the CMake root is searched from here. */
  cwd: string;
  exec: Exec;
  /** Wait bounds for the post-edit diagnostics. */
  diagnostics?: Pick<PostEditOptions, "waitMs" | "firstOpenWaitMs">;
  /** How the feature probes start clangd, and their bound. */
  toolchain?: Pick<ToolchainServiceOptions, "clangd" | "clangdTimeoutMs">;
  /** How the managed clangd starts. */
  clangd?: ClangdOptions;
}

/**
 * One harness session in one directory: root discovery and the managed configure, the managed
 * clangd, the C++ feature profiles and the project log. Root discovery and configure run in the
 * background; every method waits for them only within the report-point bound.
 */
export class CppSession {
  readonly cwd: string;
  readonly project: ProjectService;
  readonly clangd: ManagedClangd;
  readonly toolchain: ToolchainService;
  /**
   * What the session could not do (a feature clangd lacks, a check that could not run) goes to the
   * project's log in the managed cache, so results carry no notes that repeat on every call.
   */
  readonly log: Log;
  private readonly exec: Exec;
  private readonly diagnostics: CppSessionOptions["diagnostics"];

  constructor(options: CppSessionOptions) {
    this.cwd = options.cwd;
    this.exec = options.exec;
    this.diagnostics = options.diagnostics;
    this.log = message => { if (this.project.root) projectLog(this.project.root)(message); };
    this.toolchain = new ToolchainService({ exec: options.exec, log: this.log, ...options.toolchain });
    this.project = new ProjectService({
      cwd: options.cwd,
      exec: options.exec,
      notify: options.notify,
      waitMs: options.waitMs,
      // Configuring runs the repository's CMake code: only in projects the harness trusts.
      trusted: options.trusted,
      untrusted: options.untrusted,
      // The briefing lists each measured target's C++ features.
      toolchain: () => this.toolchain,
    });
    this.toolchain.attach(this.project);
    this.clangd = new ManagedClangd(options.clangd);
    this.clangd.attach(this.project);
  }

  /**
   * The system-prompt guidelines: the standard rule in a CMake project, the fixed ones elsewhere.
   * Waits for root discovery and the cmake probe, within the report-point bound.
   */
  async guidelines(): Promise<string[]> {
    await this.project.ready();
    return this.project.isCmake ? [STANDARD_GUIDELINE] : FIXED_GUIDELINES;
  }

  /**
   * What the next prompt carries: the full briefing when due, a loading message while the first
   * configure runs past the bound, later only what changed, or nothing. Outside a CMake project it
   * is always nothing.
   */
  promptMessage(): Promise<RunMessage | undefined> {
    return this.project.runMessage();
  }

  /**
   * The note after a write or edit of `file` (absolute, or relative to the session's directory):
   * the clang-format result, drift, the owning targets and their standard, and diagnostics.
   */
  postEditNote(file: string): Promise<string | undefined> {
    return postEditNote(resolveToolPath(this.cwd, file), {
      exec: this.exec, cwd: this.cwd, project: this.project, clangd: this.clangd, toolchain: this.toolchain, log: this.log, ...this.diagnostics,
    });
  }

  /** The drift note after a shell command, or after an edit with no file to check. */
  afterShell(): Promise<string | undefined> {
    return this.project.reportPoint();
  }

  /** The conversation lost the briefing; the next prompt carries it again. */
  compacted(): void {
    this.project.resendBriefing();
  }

  /** Stops the configure, the feature measurement and the managed clangd. */
  async dispose(): Promise<void> {
    this.toolchain.close();
    this.project.dispose();
    await this.clangd.close();
  }
}
