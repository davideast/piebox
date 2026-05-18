/**
 * `LlmClient` — the driver-internal LLM call surface.
 *
 * Adapters wrap third-party SDKs (currently `@inbrowser/agent` for the
 * browser path, `@earendil-works/pi-coding-agent` for the server path in
 * Step 5) to produce this shape. Layer 2 doesn't know any of this exists
 * — `LlmClient` is purely a driver concern.
 *
 * Why a driver-private interface rather than reusing the SDK's? Three
 * reasons, per investigation C:
 *   1. Insulates the driver against breaking changes in any one provider.
 *   2. Keeps the SDK dependency out of the driver core — only
 *      `./adapters/*.ts` touch it.
 *   3. Lets a non-adapter consumer (a stub for tests, a mock for the
 *      stress harness) implement `LlmClient` without pulling an SDK.
 */

import type { AgentChatMessage } from "./events.js";

// ── Tool-spec the driver sends to the LLM ───────────────────────────────

/**
 * What the driver advertises to the LLM. Shape matches what the agent
 * SDK / Gemini provider expect at registration time. The driver maps
 * `PieboxTool.inputSchema` → `parameters` (the one-line rename
 * investigation C.1 noted).
 */
export interface ChatToolSpec {
  name: string;
  description: string;
  parameters: unknown;
}

// ── Request the driver sends to the LLM each iteration ──────────────────

export interface LlmRequest {
  messages: ReadonlyArray<AgentChatMessage>;
  tools: ReadonlyArray<ChatToolSpec>;
}

// Back-compat shape alias for the field name used in the C.1 spike.
export type ChatRequest = LlmRequest;

// ── Streamed chunks from the LLM ────────────────────────────────────────

/**
 * The chunk types the driver consumes from `LlmClient.chat`. Adapters
 * translate provider-specific events into this union.
 *
 * `turn_complete` carries usage figures — the driver folds them into
 * `AgentEvent.turn_completed.usage`. (Note the field-name jump:
 * provider-side `promptTokens`/`completionTokens` becomes driver-side
 * `tokensIn`/`tokensOut`.)
 */
export type ChatChunk =
  | { kind: "text"; chunk: string }
  | { kind: "thinking"; chunk: string }
  | {
      kind: "tool_call";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      kind: "turn_complete";
      usage?: { promptTokens: number; completionTokens: number };
    }
  | { kind: "error"; message: string };

// ── Response (the streaming iterable itself) ────────────────────────────

/**
 * What `LlmClient.chat` returns. Async-iterable so the driver can
 * `for await` and forward token-shaped chunks downstream.
 */
export type LlmResponse = AsyncIterable<ChatChunk>;

// ── The client interface ────────────────────────────────────────────────

export interface LlmClient {
  chat(req: LlmRequest, signal: AbortSignal): LlmResponse;
}
