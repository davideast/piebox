/**
 * `@inbrowser/agent` adapter.
 *
 * Bridges between the driver's internal `LlmClient` shape and
 * `@inbrowser/agent`'s LLM call surface. Two surfaces ship:
 *
 *   - {@link adaptInbrowserAgentClient} — wraps an arbitrary
 *     `@inbrowser/agent` `LlmClient` (any provider — Gemini, Claude,
 *     a custom stub) into the driver-internal shape. This is the
 *     primary export.
 *
 *   - {@link createGeminiLlmClient} — convenience factory that
 *     constructs a Gemini-backed client via `@inbrowser/relay` and
 *     wraps it. Mirrors the `createGeminiClient` helper that lived
 *     in the playground's `agent.ts` before Step 4.
 *
 * **Boundary:** this is the only file in the driver package that
 * imports `@inbrowser/agent` or `@inbrowser/relay`. The driver core
 * stays SDK-agnostic.
 */

import {
  buildGeminiRequest,
  geminiEventsFromResponse,
} from "@inbrowser/relay/providers/gemini";
import type {
  LlmClient as InbrowserLlmClient,
  LlmConfig as InbrowserLlmConfig,
} from "@inbrowser/agent";
import type { ChatChunk, LlmClient, LlmRequest } from "../llm-client.js";

// ── Generic adapter (any @inbrowser/agent client) ───────────────────────

/**
 * Wrap an `@inbrowser/agent` LlmClient as a driver-internal LlmClient.
 *
 * The two shapes are structurally close — both yield `text`/`thinking`/
 * `tool_call`/`turn_complete`/`error` chunks — but the field names and
 * exact unions differ enough that a deliberate translation pass is
 * cleaner than a structural cast.
 */
export function adaptInbrowserAgentClient(
  client: InbrowserLlmClient,
): LlmClient {
  return {
    async *chat(req: LlmRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
      const sdkReq = {
        messages: req.messages.map((m) => ({
          role: m.role,
          text: m.text ?? "",
          ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
          ...(m.toolCallId !== undefined ? { toolCallId: m.toolCallId } : {}),
          ...(m.toolName !== undefined ? { toolName: m.toolName } : {}),
        })),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      };

      for await (const ev of client.chat(sdkReq as never, signal)) {
        switch (ev.kind) {
          case "text":
            yield { kind: "text", chunk: ev.chunk };
            break;
          case "thinking":
            yield { kind: "thinking", chunk: ev.chunk };
            break;
          case "tool_call":
            yield {
              kind: "tool_call",
              id: ev.id,
              name: ev.name,
              args: (ev.args ?? {}) as Record<string, unknown>,
            };
            break;
          case "turn_complete":
            yield {
              kind: "turn_complete",
              ...(ev.usage
                ? {
                    usage: {
                      promptTokens: ev.usage.promptTokens ?? 0,
                      completionTokens: ev.usage.completionTokens ?? 0,
                    },
                  }
                : {}),
            };
            break;
          case "error":
            yield { kind: "error", message: ev.message };
            break;
          default:
            // Forward-compat: unknown chunk kinds are silently dropped.
            // Adapters can be tightened when a new kind earns its place.
            break;
        }
      }
    },
  };
}

// ── Gemini convenience factory ──────────────────────────────────────────

export interface GeminiClientConfig {
  apiKey: string;
  model: string;
  /** Set to `true` when the user supplies their own key (BYOK). The
   *  relay's request builder reads this for telemetry headers. */
  isByok?: boolean;
}

/**
 * Build a driver-shape LlmClient that talks to Gemini via
 * `@inbrowser/relay`'s SSE protocol. This is the path the browser
 * playground used pre-Step-4; it lives here so future browser drivers
 * can reuse the wiring without re-deriving it.
 */
export function createGeminiLlmClient(cfg: GeminiClientConfig): LlmClient {
  return {
    async *chat(req: LlmRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
      // Translate driver-shape messages into the relay's LegacyChatMessage
      // shape. Same role + text spine, plus optional toolCalls / toolCallId
      // / toolName for tool-bearing messages.
      const messages = req.messages.map((m) => ({
        role: m.role,
        text: m.text ?? "",
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
        toolName: m.toolName,
      })) as unknown as Parameters<typeof buildGeminiRequest>[0]["messages"];

      const request = buildGeminiRequest({
        provider: "gemini",
        model: cfg.model,
        messages,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters as never,
        })),
        apiKey: cfg.apiKey,
        signal,
      });

      let response: Response;
      try {
        response = await fetch(request);
      } catch (e) {
        yield { kind: "error", message: e instanceof Error ? e.message : String(e) };
        return;
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        yield {
          kind: "error",
          message: `gemini ${response.status}: ${body.slice(0, 400)}`,
        };
        return;
      }

      let prompt = 0;
      let output = 0;

      for await (const ev of geminiEventsFromResponse(response, signal)) {
        switch (ev.kind) {
          case "text":
            yield { kind: "text", chunk: ev.chunk };
            break;
          case "thinking":
            yield { kind: "thinking", chunk: ev.chunk };
            break;
          case "tool_call":
            yield {
              kind: "tool_call",
              id: ev.callId,
              name: ev.name,
              args: (ev.args ?? {}) as Record<string, unknown>,
            };
            break;
          case "usage":
            prompt = ev.promptTokens ?? 0;
            output = ev.outputTokens ?? 0;
            break;
          case "error":
            yield { kind: "error", message: ev.message };
            break;
          default:
            break;
        }
      }

      yield {
        kind: "turn_complete",
        usage: { promptTokens: prompt, completionTokens: output },
      };
    },
  };
}

// ── Type re-exports for callers that want them ──────────────────────────

export type { InbrowserLlmClient, InbrowserLlmConfig };
