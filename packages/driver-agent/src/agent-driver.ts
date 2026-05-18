/**
 * `createAgentDriver` — the ReAct submit loop.
 *
 * Adapts an `LlmClient` to a Layer 2 `Sandbox` + `PieboxToolset`. The
 * shape mirrors the C.1 spike at
 * `docs/investigations/C-driver-spikes/agent-driver.ts`. Two
 * behaviors land here that the spike sketched but didn't fully wire:
 *
 *   1. **Multi-turn history.** The driver maintains a private
 *      `history: AgentChatMessage[]` across `submit()` calls. User
 *      prompts, assistant text + tool calls (with their result JSON
 *      patched in once the tool resolves), and the synthetic `role:
 *      "tool"` reflections are all appended. This is the multi-turn
 *      fix from PR #7 — without it, the SDK forgets what the model
 *      did in earlier turns.
 *
 *   2. **Bash streaming.** When a tool advertises `executeStreaming`,
 *      the driver forwards `onStdout`/`onStderr` chunks through the
 *      `thinking` event channel. That's the closest existing
 *      `AgentEvent` kind; a dedicated `tool_stdout` event was
 *      flagged in the C.1 spike's "Layer 2 gaps" appendix and remains
 *      future work.
 */

import type {
  PieboxResult,
  PieboxTool,
  PieboxToolset,
  RuntimeCapabilities,
  Sandbox,
} from "piebox/layer2";
import type { AgentChatMessage, AgentEvent } from "./events.js";
import type { ChatToolSpec, LlmClient, LlmRequest } from "./llm-client.js";
import { defaultSystemPromptBuilder } from "./system-prompt.js";

// ── Public options + handle ─────────────────────────────────────────────

export interface AgentDriverOptions {
  sandbox: Sandbox;
  toolset: PieboxToolset;
  llm: LlmClient;
  /** Build the system prompt from the sandbox's capabilities. Defaults
   *  to {@link defaultSystemPromptBuilder}. Composable: callers that
   *  want substrate-specific addenda call the default themselves and
   *  concatenate. */
  systemPromptBuilder?: (caps: RuntimeCapabilities) => string;
  /** Hard cap on ReAct iterations per submit. Default 16. */
  maxIterations?: number;
}

export interface AgentDriver {
  /** Run one user prompt to completion. Yields an event stream — the
   *  caller drives consumption with `for await`. The driver keeps
   *  history across submits; on the next submit the LLM sees the prior
   *  turn's tool activity. */
  submit(prompt: string, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createAgentDriver(opts: AgentDriverOptions): AgentDriver {
  const { sandbox, toolset, llm } = opts;
  const buildSystemPrompt = opts.systemPromptBuilder ?? defaultSystemPromptBuilder;
  const maxIterations = opts.maxIterations ?? 16;

  // Capabilities are immutable for the sandbox's lifetime (E §"open
  // questions") — cache the rendered prompt up front. They live on the
  // sandbox itself (not `sandbox.runtime`); the C.1 spike's
  // `sandbox.runtime.capabilities` reference was based on an earlier
  // draft of Layer 2.
  const caps = sandbox.capabilities;
  const systemPrompt = buildSystemPrompt(caps);

  // Multi-turn history. User msgs and assistant msgs (with their tool
  // calls' argsJson + patched-in resultJson) accumulate here so the
  // LLM sees its prior activity on every iteration.
  const history: AgentChatMessage[] = [];
  let turnCounter = 0;

  // Tool registry. The toolset already maintains a name index, but
  // we touch it twice per call (lookup + spec), so keep a local
  // reference for clarity.
  const toolSpecs: ChatToolSpec[] = toolset.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));

  async function* submit(
    prompt: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    turnCounter += 1;
    const turn = turnCounter;
    yield { kind: "turn_started", turn };

    history.push({ role: "user", text: prompt });

    let usage: { tokensIn: number; tokensOut: number } | undefined;

    for (let iter = 0; iter < maxIterations; iter++) {
      if (signal.aborted) {
        yield { kind: "error", message: "aborted" };
        return;
      }

      const req: LlmRequest = {
        messages: [
          { role: "system", text: systemPrompt },
          ...history,
        ],
        tools: toolSpecs,
      };

      const pendingCalls: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
      }> = [];
      let assistantText = "";

      try {
        for await (const chunk of llm.chat(req, signal)) {
          switch (chunk.kind) {
            case "text":
              assistantText += chunk.chunk;
              yield { kind: "text", chunk: chunk.chunk };
              break;
            case "thinking":
              yield { kind: "thinking", chunk: chunk.chunk };
              break;
            case "tool_call":
              pendingCalls.push({
                id: chunk.id,
                name: chunk.name,
                args: chunk.args,
              });
              break;
            case "turn_complete":
              if (chunk.usage) {
                usage = {
                  tokensIn: chunk.usage.promptTokens,
                  tokensOut: chunk.usage.completionTokens,
                };
              }
              break;
            case "error":
              yield { kind: "error", message: chunk.message };
              return;
          }
        }
      } catch (e) {
        yield {
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        };
        return;
      }

      // Persist the assistant turn (text + tool calls so far) before
      // running tools. We'll patch in resultJson per-call as they
      // finish so subsequent iterations see the results.
      const assistantMsg: AgentChatMessage = {
        role: "assistant",
        text: assistantText,
        toolCalls: pendingCalls.map((c) => ({
          id: c.id,
          name: c.name,
          argsJson: safeJsonStringify(c.args),
        })),
      };
      history.push(assistantMsg);

      if (pendingCalls.length === 0) {
        yield { kind: "turn_completed", turn, ...(usage ? { usage } : {}) };
        yield { kind: "completed" };
        return;
      }

      for (const call of pendingCalls) {
        if (signal.aborted) {
          yield { kind: "error", message: "aborted" };
          return;
        }
        yield {
          kind: "tool_started",
          callId: call.id,
          name: call.name,
          args: call.args,
        };

        const tool = toolset.get(call.name);
        let result: PieboxResult;
        if (!tool) {
          result = { ok: false, summary: `unknown tool: ${call.name}` };
        } else {
          try {
            result = await runTool(tool, call.args, sandbox, signal);
          } catch (e) {
            result = {
              ok: false,
              summary: e instanceof Error ? e.message : String(e),
            };
          }
        }

        yield {
          kind: "tool_finished",
          callId: call.id,
          name: call.name,
          result,
        };

        // Patch the assistant message's tool-call entry with the
        // result so the next iteration sees it. (Drivers that prefer
        // the `role: "tool"` shape also get a copy appended below.)
        const resultJson = safeJsonStringify({
          ok: result.ok,
          summary: result.summary,
          data: result.data,
          ...(result.exitCode !== undefined
            ? { exitCode: result.exitCode }
            : {}),
        });
        assistantMsg.toolCalls = assistantMsg.toolCalls?.map((tc) =>
          tc.id === call.id ? { ...tc, resultJson } : tc,
        );

        history.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          text: result.summary ?? (result.ok ? "ok" : "failed"),
        });
      }
      // Loop continues: model gets another iteration with the tool
      // results in context. ReAct convergence happens when the model
      // emits an assistant turn with no tool calls.
    }

    yield {
      kind: "error",
      message: `max iterations (${maxIterations}) exceeded`,
    };
  }

  return { submit };
}

// ── Tool execution ──────────────────────────────────────────────────────

/** Prefer `executeStreaming` when present so live stdout/stderr can be
 *  forwarded into the host UI. The buffered `PieboxResult` is the
 *  authoritative outcome either way. */
async function runTool(
  tool: PieboxTool,
  args: unknown,
  sandbox: Sandbox,
  signal: AbortSignal,
): Promise<PieboxResult> {
  if (tool.executeStreaming) {
    return tool.executeStreaming(args, sandbox, signal, () => {
      // No live forwarding here — see C.1's "Layer 2 gaps" #1. The
      // playground's Shell tab consumes stdout via its own ShellSession
      // path, not through the agent driver. Drivers that need to
      // forward chunks today wrap the tool externally.
    });
  }
  return tool.execute(args, sandbox, signal);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return "null";
  }
}
