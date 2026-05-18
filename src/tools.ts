/**
 * createSandboxedTools — produce a Layer 2 `PieboxToolset` over a
 * VFS + bash pair.
 *
 * Step 5 of the composable-sandbox migration plan
 * (`docs/investigations/G-migration.md`) re-typed this function: it
 * now returns `PieboxToolset` (the protocol-neutral Layer 2 shape)
 * rather than the agent SDK's `ToolDefinition[]`. The implementation
 * builds a Layer 2 `Sandbox` over the supplied substrate and
 * delegates to `createStandardToolset`.
 *
 * Breaking change: callers that previously fed the result into
 * `customTools` of an agent SDK session must now route through
 * `@piebox/driver-agent`'s `createSandboxedSession` (which builds
 * the SDK tools internally) or write their own
 * `PieboxTool → ToolDefinition` adapter.
 */

import type { PieboxFS as VirtualFileSystem } from "./fs/types.js";
import type { Bash } from "just-bash";
import {
  createSandbox,
  createStandardToolset,
  NODE_CAPABILITIES,
  type PieboxToolset,
} from "./layer2/index.js";
import type { PieboxRunOptions, PieboxRunResult, PieboxRuntime } from "./runtime/types.js";

export interface SandboxedToolsOptions {
  /**
   * Reserved for future per-toolset configuration. Today the standard
   * toolset is fully determined by the sandbox; this options bag stays
   * so the API doesn't break when configuration lands.
   */
  npmInfo?: boolean;
}

/**
 * Build a `PieboxRuntime` that dispatches commands through a just-bash
 * interpreter, so the Layer 2 Sandbox can model the substrate uniformly.
 */
function bashRuntime(bash: Bash, defaultCwd: string): PieboxRuntime {
  return {
    async run(cmd: string, options?: PieboxRunOptions): Promise<PieboxRunResult> {
      const r = await bash.exec(cmd, {
        cwd: options?.cwd ?? defaultCwd,
        signal: options?.signal,
      });
      if (options?.onStdout && r.stdout) options.onStdout(r.stdout);
      if (options?.onStderr && r.stderr) options.onStderr(r.stderr);
      return {
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
      };
    },
  };
}

/**
 * Build the standard piebox toolset (read, write, edit, ls, grep,
 * find, bash) bound to the supplied VFS + bash pair.
 *
 * @param cwd - Virtual working directory for all tools
 * @param vfs - PieboxFS instance (the filesystem foundation)
 * @param bash - just-bash Bash instance (configured with VFS adapter)
 * @param _options - Reserved for future toolset configuration
 * @returns A `PieboxToolset` drivers can adapt to their protocol of choice
 */
export function createSandboxedTools(
  cwd: string,
  vfs: VirtualFileSystem,
  bash: Bash,
  _options?: SandboxedToolsOptions,
): PieboxToolset {
  const sandbox = createSandbox({
    fs: vfs,
    runtime: bashRuntime(bash, cwd),
    capabilities: NODE_CAPABILITIES,
    cwd,
  });
  return createStandardToolset(sandbox);
}
