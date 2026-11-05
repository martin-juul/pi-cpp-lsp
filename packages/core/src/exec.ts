/** How a command runs; the same shape as pi's ExecOptions, so a harness can pass its own executor. */
export interface ExecOptions {
  signal?: AbortSignal;
  /** Milliseconds before the command is killed. */
  timeout?: number;
  cwd?: string;
}

/** A finished command. A missing program is a non-zero `code`, never a thrown error. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  /** Killed by the timeout or the signal. */
  killed: boolean;
}

/** Runs a program without a shell. */
export type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;
