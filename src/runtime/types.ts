/**
 * PieboxRuntime — minimal interface for dispatching shell-style commands
 * (`node script.js`, `npm install zod`, `npm run dev`) into a sandbox.
 *
 * Today this is needed only for the browser backend (almostnode), where the
 * agent's tool layer needs a single entrypoint that resolves to almostnode's
 * `container.run`. The Node backend can implement the same interface later by
 * wrapping piebox's existing `just-bash` Bash instance — out of scope for the
 * Scenario A substrate task.
 *
 * The shape is deliberately the lowest common denominator between almostnode's
 * `container.run` and just-bash's `Bash.exec`, so a Node-side implementation
 * later doesn't require changes here.
 */

export interface PieboxRunOptions {
  /** Working directory for the command. */
  cwd?: string;
  /** Abort signal for long-running commands. */
  signal?: AbortSignal;
  /** Streaming stdout chunks (for `npm run dev`, watchers, etc.). */
  onStdout?: (chunk: string) => void;
  /** Streaming stderr chunks. */
  onStderr?: (chunk: string) => void;
}

export interface PieboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PieboxRuntime {
  /**
   * Run a shell-style command. The string is parsed by the underlying runtime
   * (almostnode's internal just-bash for the browser backend).
   */
  run(cmd: string, options?: PieboxRunOptions): Promise<PieboxRunResult>;

  /**
   * Resolve an in-sandbox port to a fetchable URL via the Service Worker
   * bridge. Returns `null` if no server is registered on that port.
   *
   * Browser backend only. Returns `null` from Node-side implementations.
   */
  getServerUrl?(port: number): string | null;

  /**
   * Pipe a string into the running command's stdin (browser backend only).
   * Useful for `node` REPLs and interactive scripts.
   */
  sendInput?(data: string): void;
}
