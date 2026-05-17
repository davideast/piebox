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
 * This file is intentionally minimal at scaffold time. Step 4 fills
 * in `createAgentDriver`, `AgentEvent`, and the browser adapter.
 * Step 5 fills in the server-side adapter plus the session/skills
 * scaffolding moved out of `piebox` core.
 *
 * See `docs/investigations/G-migration.md` Steps 4 + 5.
 */

// Re-exports land here as each step delivers its slice.
export {};
