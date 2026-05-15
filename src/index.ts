/**
 * pi-sandbox — Fully in-memory sandboxed agent sessions for the Pi SDK.
 *
 * Architecture:
 *   @platformatic/vfs  ← foundation (node:fs-compatible in-memory filesystem)
 *       ├── just-bash  ← shell interpreter (via IFileSystem adapter)
 *       ├── Pi SDK     ← tool operations (direct VFS sync API)
 *       └── consumer   ← isomorphic-git, require(), or any node:fs user
 *
 * Public API:
 *   createSandboxedSession()   — Primary factory (most consumers need only this)
 *   createSandboxedTools()     — Advanced: build tool definitions à la carte
 *   createBashFsAdapter()      — Advanced: bridge VFS → just-bash IFileSystem
 *
 * @example
 * ```ts
 * import { createSandboxedSession } from "./src";
 * import { getModel } from "@earendil-works/pi-ai";
 *
 * const { session, vfs, bash } = await createSandboxedSession({
 *   model: getModel("google", "gemini-3-flash-preview"),
 *   seed: { "hello.txt": "Hello, sandbox!" },
 * });
 *
 * await session.prompt("Read hello.txt and tell me what it says.");
 *
 * // vfs is node:fs-compatible — pass directly to isomorphic-git
 * // await git.init({ fs: vfs, dir: "/sandbox" });
 * ```
 */

// ─── Primary API ────────────────────────────────────────────────────────────

export { createSandboxedSession } from "./session.js";
export { cloneIntoSandbox, createGitUtilities } from "./git.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type { SandboxSessionOptions, SandboxSessionResult } from "./types.js";
export type { CloneOptions, CloneResult, GitUtilities } from "./git.js";

// ─── Skills ─────────────────────────────────────────────────────────────────
// Re-exported so consumers can construct Skill objects without a direct
// dependency on @earendil-works/pi-coding-agent.

export type { Skill } from "@earendil-works/pi-coding-agent";
export { createSyntheticSourceInfo } from "@earendil-works/pi-coding-agent";
export { loadSkillsFromVFS } from "./skills.js";
export type { LoadSkillsFromVFSOptions } from "./skills.js";

// ─── Advanced API ───────────────────────────────────────────────────────────

export { createSandboxedTools } from "./tools.js";
export { createBashFsAdapter } from "./adapters/bash-fs-adapter.js";
export { createGitFsAdapter } from "./adapters/git-fs-adapter.js";
export {
  createBashOperations,
  createReadOperations,
  createWriteOperations,
  createEditOperations,
  createGrepOperations,
  createFindOperations,
  createLsOperations,
} from "./operations/index.js";

// ─── Re-exports ─────────────────────────────────────────────────────────────
// Consumers get the key primitives without adding direct dependencies.

export { create as createVFS } from "@platformatic/vfs";
export type { VirtualFileSystem, VFSOptions } from "@platformatic/vfs";
export { Bash } from "just-bash";
export type { BashOptions } from "just-bash";
