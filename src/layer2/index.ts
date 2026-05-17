/**
 * Layer 2 — the protocol-neutral capability surface.
 *
 * This entry point is what driver packages (`@piebox/driver-agent`,
 * `@piebox/driver-mcp`, future CLI / REST / pool) consume. It exposes
 * the sandbox primitive, the tool descriptor + toolset, and the
 * runtime capability fingerprint — and nothing else. No agent-SDK
 * types, no streaming event union, no driver-specific surfaces.
 *
 * See `docs/explanation/composable-sandbox.md` for the layering
 * rationale and `docs/investigations/G-migration.md` for the
 * migration plan. This file is Step 3's deliverable.
 *
 * Import shape:
 *
 *     import {
 *       createSandbox,
 *       createStandardToolset,
 *       BROWSER_CAPABILITIES,
 *       type Sandbox,
 *       type PieboxTool,
 *       type RuntimeCapabilities,
 *     } from "piebox/layer2";
 */

// ── Sandbox primitive ────────────────────────────────────────────────────

export { createSandbox } from "./sandbox.js";
export type {
  Sandbox,
  SandboxEvent,
  CreateSandboxOptions,
  SandboxToTarballOptions,
  SandboxToGitPackOptions,
  SandboxApplyPatchOptions,
} from "./sandbox.js";

// ── Tool descriptor + toolset ───────────────────────────────────────────

export { createToolset } from "./tool.js";
export type {
  PieboxTool,
  PieboxResult,
  PieboxToolSchema,
  PieboxToolset,
} from "./tool.js";

// ── Standard toolset ────────────────────────────────────────────────────

export { createStandardToolset } from "./standard-toolset.js";

// ── Capabilities ────────────────────────────────────────────────────────

export {
  BROWSER_CAPABILITIES,
  NODE_CAPABILITIES,
} from "./capabilities.js";
export type { RuntimeCapabilities } from "./capabilities.js";
