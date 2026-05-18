/**
 * Public types for `@piebox/driver-agent`'s server-side session
 * factory (`createSandboxedSession`).
 *
 * Moved from `piebox`'s `src/types.ts` in Step 5 of the
 * composable-sandbox migration plan
 * (`docs/investigations/G-migration.md`). The shape is unchanged
 * other than the added `sandbox` + `cwd` fields on
 * `SandboxSessionResult`, which surface the Layer 2 substrate the
 * session was built over.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AuthStorage,
  ModelRegistry,
  Skill,
  ToolDefinition,
  AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { PieboxFS as VirtualFileSystem } from "piebox";
import type { Sandbox } from "piebox/layer2";
import type { Bash, BashOptions } from "just-bash";

/** Options for creating a sandboxed agent session. */
export interface SandboxSessionOptions {
  /** Model to use. Required. */
  model: Model<any>;

  /**
   * Virtual filesystem root / working directory.
   * All tool operations are scoped to this path.
   * @default "/sandbox"
   */
  cwd?: string;

  /**
   * Pre-configured PieboxFS instance.
   * When provided, seed files are still applied on top.
   * Use this for custom VFS configurations (overlay, sqlite provider, etc.).
   */
  vfs?: VirtualFileSystem;

  /**
   * Pre-configured just-bash instance.
   * When provided, `bashOptions` is ignored and the Bash instance is used as-is.
   * The Bash instance should be configured with a VFS-backed IFileSystem adapter.
   */
  bash?: Bash;

  /**
   * Seed files as a path→content record.
   * Paths are resolved relative to `cwd`.
   *
   * @example
   * ```ts
   * seed: {
   *   "README.md": "# My Project",
   *   "src/index.ts": "console.log('hello');",
   * }
   * ```
   */
  seed?: Record<string, string>;

  /**
   * Additional just-bash options (execution limits, python/js support, etc.).
   * Merged with the library's defaults. Ignored when `bash` is provided.
   *
   * @example
   * ```ts
   * bashOptions: {
   *   python: true,
   *   executionLimits: { maxCommandCount: 200 },
   * }
   * ```
   */
  bashOptions?: Omit<BashOptions, "fs" | "cwd">;

  /**
   * Additional system prompt lines appended after the sandbox preamble.
   */
  systemPrompt?: string[];

  /** Thinking level for the model. @default "medium" */
  thinkingLevel?: ThinkingLevel;

  /** Auth storage. @default AuthStorage.create() */
  authStorage?: AuthStorage;

  /** Model registry. @default ModelRegistry.create(authStorage) */
  modelRegistry?: ModelRegistry;

  /**
   * Additional custom tools registered alongside the sandboxed built-ins.
   * These are NOT sandboxed — they have full access to whatever they implement.
   */
  additionalTools?: ToolDefinition[];

  /**
   * Skills to inject into the agent's system prompt.
   * Skills provide domain-specific knowledge and instructions
   * without modifying tools or the VFS.
   *
   * Note: Skill files are read from the **host** filesystem at
   * `loader.reload()` time, not from the VFS.
   */
  skills?: Skill[];

  /**
   * Directories on the host filesystem to scan for SKILL.md files.
   * Uses standard discovery rules:
   *   - Directory with SKILL.md = skill root (no further recursion)
   *   - Otherwise, load direct .md children and recurse subdirectories
   */
  skillPaths?: string[];
}

/** Result from createSandboxedSession. */
export interface SandboxSessionResult {
  /** The created AgentSession, ready for `.prompt()`. */
  session: AgentSession;

  /**
   * The PieboxFS instance — the filesystem foundation.
   * Pass this to isomorphic-git, use with `vfs.mount()`, or access
   * files directly via `vfs.readFileSync()` / `vfs.writeFileSync()`.
   */
  vfs: VirtualFileSystem;

  /** The just-bash instance for direct shell execution. */
  bash: Bash;

  /**
   * The Layer 2 Sandbox the session was built over. Exposes the
   * substrate fingerprint (`capabilities`) and workflow surfaces
   * (`toTarball`, `applyPatch`, lifecycle events).
   */
  sandbox: Sandbox;

  /** Virtual working directory all tool operations are scoped to. */
  cwd: string;
}
