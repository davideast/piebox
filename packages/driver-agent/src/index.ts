/**
 * @piebox/driver-agent — agent-loop driver for piebox sandboxes.
 *
 * Consumes `piebox/layer2` (Sandbox + PieboxTool + PieboxToolset).
 * Adapts an LLM client to a ReAct submit loop, threads multi-turn
 * history including tool calls, and templates the sandbox's
 * RuntimeCapabilities into the system prompt.
 *
 * Two sibling concerns are wired through separate adapter files in
 * `./adapters/`:
 *   - `./adapters/inbrowser-agent.ts` — bridges to `@inbrowser/agent`'s
 *     LLM call surface (used by the browser playground).
 *   - `./adapters/pi-coding-agent.ts` — bridges to the server-side
 *     `@earendil-works/pi-coding-agent` SDK.
 *
 * Exports land here in two phases (Steps 4 and 5 of the
 * composable-sandbox migration). The section markers below keep
 * parallel work cleanly disjoint — each step fills only its own
 * section so a rebase between them is purely additive.
 */

// ─── Step 4 — browser path (createAgentDriver, AgentEvent, inbrowser-agent adapter) ───

export { createAgentDriver } from "./agent-driver.js";
export type { AgentDriver, AgentDriverOptions } from "./agent-driver.js";

export type {
  AgentEvent,
  AgentChatMessage,
  AgentToolArgs,
  AgentUsage,
} from "./events.js";

export type {
  LlmClient,
  LlmRequest,
  LlmResponse,
  ChatChunk,
  ChatRequest,
  ChatToolSpec,
} from "./llm-client.js";

export { defaultSystemPromptBuilder } from "./system-prompt.js";

export {
  adaptInbrowserAgentClient,
  createGeminiLlmClient,
} from "./adapters/inbrowser-agent.js";
export type { GeminiClientConfig } from "./adapters/inbrowser-agent.js";

// ─── Step 5 — server path moved to `./server` sub-entry ───
//
// The session/skills surface used to live here too. It moved to
// `@piebox/driver-agent/server` so the browser playground (which only
// consumes the Step-4 surface above) doesn't transitively pull
// `@earendil-works/pi-coding-agent` and its `node:url` / `node:fs`
// dependencies into the Vite bundle. Server-side consumers (CLI
// handlers, the driver-mcp stdio entry) explicitly import:
//
//     import { createSandboxedSession } from "@piebox/driver-agent/server";
