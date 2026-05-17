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

// ─── Step 5 — server path (session/skills surface, pi-coding-agent adapter) ───

export {};
