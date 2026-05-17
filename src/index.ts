/**
 * piebox — Lightweight in-memory sandbox environment for agent execution.
 *
 * Architecture:
 *   sandbox.fs     ← @platformatic/vfs (node:fs-compatible in-memory filesystem)
 *   sandbox.shell  ← just-bash (shell interpreter over the same fs)
 *   sandbox.git    ← isomorphic-git (after clone, same fs)
 *
 * @example
 * ```ts
 * import { sandbox } from "piebox";
 * import { getModel } from "@earendil-works/pi-ai";
 *
 * const sb = sandbox();
 * await sb.clone({ url: "https://github.com/user/repo" });
 *
 * const session = await sb.createSession({
 *   model: getModel("google", "gemini-3-flash-preview"),
 * });
 *
 * await session.prompt("Refactor the error handling.");
 * const changed = await sb.git.modifiedFiles();
 * ```
 */

// ─── Primary API ────────────────────────────────────────────────────────────

export { sandbox } from "./sandbox.js";
export type {
  SandboxOptions,
  SandboxInstance,
  SandboxCloneOptions,
  SessionOptions,
  VFSSnapshot,
  ExportOptions,
  ExportResult,
} from "./sandbox.js";

// ─── Secrets ─────────────────────────────────────────────────────────────────────

export { SecretsScrubber, resolveSecrets, generateBootstrap } from "./secrets.js";
export type { SecretsConfig, SecretsFullConfig, ResolvedSecrets } from "./secrets.js";

// ─── Git ────────────────────────────────────────────────────────────────────

export type { CloneOptions, CloneResult, GitUtilities } from "./git.js";

// ─── Skills ─────────────────────────────────────────────────────────────────

export type { Skill } from "@earendil-works/pi-coding-agent";
export { createSyntheticSourceInfo } from "@earendil-works/pi-coding-agent";
export { loadSkillsFromVFS } from "./skills.js";
export type { LoadSkillsFromVFSOptions } from "./skills.js";

// ─── Advanced API ───────────────────────────────────────────────────────────
// Escape hatches for consumers who need lower-level access.

export { createSandboxedSession } from "./session.js";
export type { SandboxSessionOptions, SandboxSessionResult } from "./types.js";
export { cloneIntoSandbox, createGitUtilities } from "./git.js";
export { createSandboxedTools } from "./tools.js";
export type { SandboxedToolsOptions } from "./tools.js";
export { createNpmInfoToolDefinition } from "./tools/npm-info.js";
export type { NpmInfoToolOptions } from "./tools/npm-info.js";
export { createBashFsAdapter } from "./adapters/bash-fs-adapter.js";
export { createGitFsAdapter } from "./adapters/git-fs-adapter.js";

// ─── Re-exports ─────────────────────────────────────────────────────────────
// Consumers get the key primitives without adding direct dependencies.

export {
  create as createVFS,
  createNodeFs,
  createBrowserFs,
} from "./fs/index.js";
export type {
  PieboxFS,
  VirtualFileSystem,
  AlmostnodeVirtualFsLike,
  CreateVFSOptions,
} from "./fs/index.js";
export type { VFSOptions } from "@platformatic/vfs";
export { Bash } from "just-bash";
export type { BashOptions } from "just-bash";

// ─── Runtime hook (browser-only for now) ─────────────────────────────────
export type { PieboxRuntime, PieboxRunOptions, PieboxRunResult } from "./runtime/index.js";
export { createBrowserRuntime } from "./runtime/index.js";
export type { AlmostnodeContainerLike } from "./runtime/index.js";
