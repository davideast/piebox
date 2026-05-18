/**
 * Consumer-facing event union the agent driver emits from `submit()`.
 *
 * Eight kinds, no more. The legacy `SessionEvent` carried three branches
 * (`workspace_changed`, `runtime_changed`, `strategy_event`) that
 * investigation D confirmed had no consumers in any product —
 * they're dropped here.
 *
 * Keep this surface narrow. New kinds land only when a real driver
 * demands one (investigation D's "no events without consumers" rule).
 */

import type { PieboxResult } from "piebox/layer2";

// ── Tool-call payloads ──────────────────────────────────────────────────

/** Args after the LLM has produced a parsed tool call. JSON-shaped. */
export type AgentToolArgs = Record<string, unknown>;

// ── Per-turn usage ──────────────────────────────────────────────────────

/** Token usage emitted at the end of each turn. Field names follow the
 *  driver's "tokensIn / tokensOut" convention (vs the LLM client's
 *  "promptTokens / completionTokens"). */
export interface AgentUsage {
  tokensIn: number;
  tokensOut: number;
}

// ── The event union ─────────────────────────────────────────────────────

export type AgentEvent =
  /** A new turn (one full LLM round-trip, possibly with multiple tool
   *  calls and iterations) just started. */
  | { kind: "turn_started"; turn: number }
  /** Streamed assistant text token. */
  | { kind: "text"; chunk: string }
  /** Streamed "thinking" / reasoning chunk (provider-dependent). */
  | { kind: "thinking"; chunk: string }
  /** The LLM asked the driver to run a tool. Args are parsed JSON. */
  | { kind: "tool_started"; callId: string; name: string; args: AgentToolArgs }
  /** A tool call returned. Result is the Layer 2 PieboxResult verbatim. */
  | { kind: "tool_finished"; callId: string; name: string; result: PieboxResult }
  /** The turn's LLM round-trip + any tool work both finished. The driver
   *  emits this only after all tool calls in the turn resolve. */
  | { kind: "turn_completed"; turn: number; usage?: AgentUsage }
  /** A fatal error. The submit iterator returns after this. */
  | { kind: "error"; message: string }
  /** The submit's terminal event — the driver emits this when the LLM
   *  produced a turn with no tool calls (i.e. a final assistant reply).
   *  The submit iterator returns after this. */
  | { kind: "completed" };

// ── Internal chat history shape (driver-private; exported for testing) ──

/**
 * The shape the driver keeps in its private history array. The driver
 * threads this back to the LLM client on every iteration so the model
 * sees its prior tool calls and their results.
 *
 * Adapters convert this into whatever shape their wire protocol wants
 * (e.g. @inbrowser/agent's NormalizedMessage).
 */
export interface AgentChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  text?: string;
  /** Tool calls attached to an assistant message. Each entry's
   *  `resultJson` is patched in after the corresponding tool resolves.
   *
   *  `signature` carries provider-specific round-trip data. Gemini
   *  requires its `thoughtSignature` to be echoed back on the next
   *  turn's matching assistant message — without it the API returns
   *  400 "Function call is missing a thought_signature". Adapters
   *  for providers that don't use signatures leave this undefined. */
  toolCalls?: ReadonlyArray<{
    id: string;
    name: string;
    argsJson: string;
    resultJson?: string;
    signature?: string;
  }>;
  /** Set on `role: "tool"` messages. */
  toolCallId?: string;
  toolName?: string;
}
