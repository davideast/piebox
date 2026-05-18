/**
 * piebox — Lightweight in-memory sandbox environment for agent execution.
 *
 * Architecture:
 *   sandbox.fs     ← @platformatic/vfs (node:fs-compatible in-memory filesystem)
 *   sandbox.shell  ← just-bash (shell interpreter over the same fs)
 *   sandbox.git    ← isomorphic-git (after clone, same fs)
 *
 * The piebox core exposes the substrate and Layer 2 capability
 * surface. Agent-loop integration (sessions, skills, the agent SDK
 * adapter, the SDK toolset) lives in `@piebox/driver-agent`. MCP
 * server integration lives in `@piebox/driver-mcp`.
 *
 * Step 5 of the composable-sandbox migration plan
 * (`docs/investigations/G-migration.md`) moved the following exports
 * out of `piebox`:
 *   - `createSandboxedSession` → `@piebox/driver-agent`
 *   - `loadSkillsFromVFS` + `LoadSkillsFromVFSOptions` → `@piebox/driver-agent`
 *   - `SandboxSessionOptions` / `SandboxSessionResult` → `@piebox/driver-agent`
 *   - `Skill` + `createSyntheticSourceInfo` re-exports → `@piebox/driver-agent`
 *   - `createNpmInfoToolDefinition` → replaced by the `npmInfoTool`
 *     `PieboxTool` exported from `piebox/tools/npm-info`. Wire it via
 *     `createToolset([...standard, npmInfoTool])` from `piebox/layer2`.
 *   - `sandbox().createSession(...)` method → replaced by
 *     `createSandboxedSession({ vfs: sb.fs, bash: sb.shell, cwd: sb.cwd })`
 *     from `@piebox/driver-agent`.
 *
 * `createSandboxedTools` is retained but its return type changed from
 * the agent SDK's `ToolDefinition[]` to Layer 2's `PieboxToolset`.
 *
 * @example
 * ```ts
 * import { sandbox } from "piebox";
 * import { createSandboxedSession } from "@piebox/driver-agent";
 * import { getModel } from "@earendil-works/pi-ai";
 *
 * const sb = sandbox();
 * await sb.clone({ url: "https://github.com/user/repo" });
 *
 * const { session } = await createSandboxedSession({
 *   model: getModel("google", "gemini-3-flash-preview"),
 *   vfs: sb.fs,
 *   bash: sb.shell,
 *   cwd: sb.cwd,
 * });
 *
 * await session.prompt("Refactor the error handling.");
 * const changed = await sb.git?.modifiedFiles();
 * ```
 */

// ─── Primary API ────────────────────────────────────────────────────────────

export { sandbox } from "./sandbox.js";
export type {
  SandboxOptions,
  SandboxInstance,
  SandboxCloneOptions,
  VFSSnapshot,
  ExportOptions,
  ExportResult,
} from "./sandbox.js";

// ─── Secrets ─────────────────────────────────────────────────────────────────────

export { SecretsScrubber, resolveSecrets, generateBootstrap } from "./secrets.js";
export type { SecretsConfig, SecretsFullConfig, ResolvedSecrets } from "./secrets.js";

// ─── Git ────────────────────────────────────────────────────────────────────

export type { CloneOptions, CloneResult, GitUtilities } from "./git.js";

// ─── Advanced API ───────────────────────────────────────────────────────────
// Escape hatches for consumers who need lower-level access.

export { cloneIntoSandbox, createGitUtilities } from "./git.js";
export { createSandboxedTools } from "./tools.js";
export type { SandboxedToolsOptions } from "./tools.js";
export { npmInfoTool } from "./tools/npm-info.js";
export type { NpmInfoArgs } from "./tools/npm-info.js";
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

// ─── Piebox-native operation types ───────────────────────────────────────
// Also available under the `piebox/operations` sub-path for consumers
// who only need the types and don't want to pull in the full piebox
// entry. Step 2 of the composable-sandbox migration plan; see
// docs/investigations/G-migration.md.
export type {
  ReadOperations,
  WriteOperations,
  EditOperations,
  LsOperations,
  GrepOperations,
  FindOperations,
  BashOperations,
} from "./operations/index.js";
