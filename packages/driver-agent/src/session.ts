/**
 * createSandboxedSession — the server-side entrypoint for
 * `@piebox/driver-agent`.
 *
 * Same public shape as the pre-Step-5 piebox export
 * (`{ session, vfs, bash }` plus the new `sandbox` + `cwd` fields),
 * with the internals re-shaped to build a Layer 2 `Sandbox`
 * (`piebox/layer2`) first and use that as the foundation. The
 * agent SDK's `AgentSession` is now produced by the
 * `./adapters/pi-coding-agent.ts` adapter — it's an output of the
 * driver, not the central abstraction.
 *
 * Step 5 of the composable-sandbox migration plan
 * (`docs/investigations/G-migration.md`).
 */

import { Bash } from "just-bash";
import {
  createBashFsAdapter,
  createVFS,
  type PieboxFS as VirtualFileSystem,
  type PieboxRunOptions,
  type PieboxRunResult,
  type PieboxRuntime,
} from "piebox";
import {
  createSandbox,
  NODE_CAPABILITIES,
  type Sandbox,
} from "piebox/layer2";
import {
  createPiCodingAgentSession,
} from "./adapters/pi-coding-agent.js";
import type { SandboxSessionOptions, SandboxSessionResult } from "./types.js";

const DEFAULT_CWD = "/sandbox";

/**
 * Build a `PieboxRuntime` that dispatches commands through a just-bash
 * interpreter. Lets the Layer 2 sandbox model the substrate uniformly
 * (`sandbox.runtime.run(...)`) on the server even though we still hand
 * the raw `Bash` to the agent SDK for richer exec semantics.
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
 * Create a sandboxed Pi agent session.
 *
 * @example
 * ```ts
 * import { createSandboxedSession } from "@piebox/driver-agent";
 * import { getModel } from "@earendil-works/pi-ai";
 *
 * const { session, vfs, bash } = await createSandboxedSession({
 *   model: getModel("google", "gemini-3-flash-preview"),
 *   seed: {
 *     "README.md": "# My Project",
 *     "src/index.ts": 'console.log("Hello!");',
 *   },
 * });
 *
 * await session.prompt("What files are in the directory?");
 * ```
 */
export async function createSandboxedSession(
  options: SandboxSessionOptions,
): Promise<SandboxSessionResult> {
  const cwd = options.cwd ?? DEFAULT_CWD;

  // ── Substrate: VFS + just-bash ───────────────────────────────────────
  const vfs: VirtualFileSystem =
    options.vfs ?? createVFS({ moduleHooks: false });

  try {
    vfs.mkdirSync(cwd, { recursive: true });
  } catch {
    // Already exists.
  }

  if (options.seed) {
    for (const [relativePath, content] of Object.entries(options.seed)) {
      const fullPath = relativePath.startsWith("/")
        ? relativePath
        : `${cwd}/${relativePath}`;
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      if (parentDir && parentDir !== cwd) {
        try {
          vfs.mkdirSync(parentDir, { recursive: true });
        } catch {
          // Already exists.
        }
      }
      vfs.writeFileSync(fullPath, content);
    }
  }

  let bash: Bash;
  if (options.bash) {
    bash = options.bash;
  } else {
    const bashFs = createBashFsAdapter(vfs);
    bash = new Bash({
      fs: bashFs,
      cwd,
      ...options.bashOptions,
    });
  }

  // ── Layer 2 Sandbox — substrate fingerprint + workflow surface ───────
  const sandbox: Sandbox = createSandbox({
    fs: vfs,
    runtime: bashRuntime(bash, cwd),
    capabilities: NODE_CAPABILITIES,
    cwd,
  });

  // ── Agent SDK session via adapter ────────────────────────────────────
  const session = await createPiCodingAgentSession({
    sandbox,
    bash,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    systemPrompt: options.systemPrompt,
    skills: options.skills,
    skillPaths: options.skillPaths,
    additionalTools: options.additionalTools,
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
  });

  return { session, vfs, bash, sandbox, cwd };
}

// ── Re-exports ────────────────────────────────────────────────────────────

export type { SandboxSessionOptions, SandboxSessionResult } from "./types.js";
export type { AgentSession, Skill, ToolDefinition } from "./adapters/pi-coding-agent.js";
export { AuthStorage, ModelRegistry } from "./adapters/pi-coding-agent.js";
