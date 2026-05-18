/**
 * @piebox/driver-agent/server — Node-side agent driver surface.
 *
 * Holds the Step-5 server path: `createSandboxedSession`,
 * `loadSkillsFromVFS`, the pi-coding-agent adapter, and the SDK
 * types that referenced packages re-export through these.
 *
 * The split from the main `@piebox/driver-agent` entry exists so
 * the browser playground (which only consumes the Step-4 surface)
 * doesn't transitively pull `@earendil-works/pi-coding-agent` and
 * its `node:url` / `node:fs` dependencies into its Vite bundle.
 * Consumers that want the server path import from this entry
 * explicitly:
 *
 *     import { createSandboxedSession } from "@piebox/driver-agent/server";
 *
 * The browser path stays on the main entry:
 *
 *     import { createAgentDriver } from "@piebox/driver-agent";
 */

export { createSandboxedSession } from "./session.js";
export type {
  SandboxSessionOptions,
  SandboxSessionResult,
} from "./types.js";
export { loadSkillsFromVFS } from "./skills.js";
export type { LoadSkillsFromVFSOptions } from "./skills.js";
export { createPiCodingAgentSession } from "./adapters/pi-coding-agent.js";
export type {
  AgentSession,
  Skill,
  ToolDefinition,
  PiCodingAgentSessionInputs,
} from "./adapters/pi-coding-agent.js";
export { AuthStorage, ModelRegistry } from "./adapters/pi-coding-agent.js";
// Re-export `createSyntheticSourceInfo` from the agent SDK for
// consumers that build their own Skill objects.
export { createSyntheticSourceInfo } from "@earendil-works/pi-coding-agent";
