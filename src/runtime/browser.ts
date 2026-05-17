/**
 * Browser binding for PieboxRuntime — wraps an almostnode container.
 *
 * piebox does NOT import `almostnode` directly. The browser entrypoint (or a
 * downstream consumer) constructs the container via `almostnode.createContainer()`
 * and passes it here. This keeps almostnode off the Node code path.
 *
 * What this gives the agent tool layer in the browser:
 *   • `run("npm install zod")` — real package install
 *   • `run("node script.js")` — execute scripts in the VFS
 *   • `getServerUrl(port)` — resolve an in-sandbox HTTP server to a real URL
 *     via the Service Worker bridge (the Hono / Category 3 path).
 */

import type {
  PieboxRunOptions,
  PieboxRunResult,
  PieboxRuntime,
} from "./types.js";

/**
 * Structural type matching almostnode's `createContainer()` return value.
 * Only the surface piebox uses is included.
 */
export interface AlmostnodeContainerLike {
  run(
    cmd: string,
    opts?: {
      cwd?: string;
      signal?: AbortSignal;
      onStdout?: (chunk: string) => void;
      onStderr?: (chunk: string) => void;
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;

  sendInput?(data: string): void;

  serverBridge?: {
    getServerUrl(port: number): string | null;
  };
}

export interface CreateBrowserRuntimeOptions {
  /** The almostnode container, typically from `createContainer()`. */
  container: AlmostnodeContainerLike;
}

/**
 * Build a PieboxRuntime backed by an almostnode container.
 */
export function createBrowserRuntime(
  options: CreateBrowserRuntimeOptions,
): PieboxRuntime {
  const { container } = options;

  return {
    async run(cmd: string, opts?: PieboxRunOptions): Promise<PieboxRunResult> {
      const result = await container.run(cmd, opts);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },

    getServerUrl(port: number): string | null {
      const bridge = container.serverBridge;
      if (!bridge) return null;
      try {
        return bridge.getServerUrl(port);
      } catch {
        return null;
      }
    },

    sendInput(data: string): void {
      if (container.sendInput) {
        container.sendInput(data);
      }
    },
  };
}
