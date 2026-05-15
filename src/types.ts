/**
 * Public types for the pi-sandbox library.
 *
 * Architecture:
 *   @platformatic/vfs  ← foundation (node:fs-compatible in-memory filesystem)
 *       ├── just-bash  ← shell interpreter (via IFileSystem adapter)
 *       ├── Pi SDK     ← tool operations (via direct VFS access)
 *       └── (future)   ← isomorphic-git, Node.js require(), etc.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AuthStorage,
  ModelRegistry,
  ToolDefinition,
  AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { VirtualFileSystem } from "@platformatic/vfs";
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
   * Pre-configured @platformatic/vfs instance.
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
}

/** Result from createSandboxedSession. */
export interface SandboxSessionResult {
  /** The created AgentSession, ready for `.prompt()`. */
  session: AgentSession;

  /**
   * The @platformatic/vfs instance — the filesystem foundation.
   * Pass this to isomorphic-git, use with `vfs.mount()`, or access
   * files directly via `vfs.readFileSync()` / `vfs.writeFileSync()`.
   */
  vfs: VirtualFileSystem;

  /** The just-bash instance for direct shell execution. */
  bash: Bash;
}
