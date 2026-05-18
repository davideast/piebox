# @piebox/driver-agent

Agent-loop driver for piebox sandboxes.

Consumes `piebox/layer2` and exposes a ReAct-style `submit(prompt, signal)`
that streams `AgentEvent`s. Pair with any LLM client via the adapters in
`src/adapters/`.

> This package is part of the composable-sandbox migration (see
> [`docs/investigations/G-migration.md`](../../docs/investigations/G-migration.md)).
> It ships in scaffold form in Step 4 and gains its server-side
> session/skills surface in Step 5.

## Status

Pre-1.0 (`private: true`). Not on npm — installed via the piebox
workspace.

## Public API

Each step extends this:

- **Step 4:** `createAgentDriver`, `AgentEvent`, `LlmClient`,
  `defaultSystemPromptBuilder`, and the `@inbrowser/agent` adapter
  (browser path).
- **Step 5:** server-side session helpers and the
  `@earendil-works/pi-coding-agent` adapter.
