/**
 * @piebox/driver-agent — spike implementation
 *
 * Wraps an LLM-backed ReAct loop over a Layer 2 sandbox + toolset.
 * Compiles ONLY against ./layer2.d.ts — no agent-SDK, no piebox, no
 * provider package. Any place this spike has to reach outside the
 * contract is flagged with `// TODO: layer2 missing` and enumerated
 * at the bottom of this file.
 */

import type {
  Sandbox,
  PieboxToolset,
  PieboxTool,
  PieboxResult,
  RuntimeCapabilities,
} from "./layer2.d.ts";

// ─────────────────────────────────────────────────────────────────────
// Driver-internal LlmClient (NOT a Layer 2 concern)
// ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  text?: string;
  toolCalls?: ReadonlyArray<{ id: string; name: string; argsJson: string; resultJson?: string }>;
  toolCallId?: string;
  toolName?: string;
}

export interface ChatToolSpec {
  name: string;
  description: string;
  parameters: unknown; // JSON-Schema-shaped
}

export interface ChatRequest {
  messages: ReadonlyArray<ChatMessage>;
  tools: ReadonlyArray<ChatToolSpec>;
}

export type ChatChunk =
  | { kind: "text"; chunk: string }
  | { kind: "thinking"; chunk: string }
  | { kind: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { kind: "turn_complete"; usage?: { promptTokens: number; completionTokens: number } }
  | { kind: "error"; message: string };

export interface LlmClient {
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
}

// ─────────────────────────────────────────────────────────────────────
// Driver-emitted AgentEvent (consumer-facing)
// strategy_event / workspace_changed / runtime_changed dropped per A's audit.
// ─────────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { kind: "turn_started"; turn: number }
  | { kind: "text"; chunk: string }
  | { kind: "thinking"; chunk: string }
  | { kind: "tool_started"; callId: string; name: string; args: Record<string, unknown> }
  | { kind: "tool_finished"; callId: string; name: string; result: PieboxResult }
  | { kind: "turn_completed"; turn: number; usage?: { tokensIn: number; tokensOut: number } }
  | { kind: "error"; message: string }
  | { kind: "completed" };

// ─────────────────────────────────────────────────────────────────────
// Default capability-templated system prompt (~30 lines)
// ─────────────────────────────────────────────────────────────────────

export function defaultSystemPromptBuilder(caps: RuntimeCapabilities): string {
  const bins = caps.availableBinaries.length > 0 ? caps.availableBinaries.join(", ") : "(none — only sandbox shims)";
  const shimGuidance = caps.processModel === "shim"
    ? [
        "Process model: SHIM. `bash` runs through a bundled mini-shell.",
        "- `node -e '<code>'` is translated: code is written to a tempfile and executed.",
        "- `npm create <name>` / `npm init <name>` are translated to install + run-bin.",
        "- `npm install` only honors `dependencies` (NOT `devDependencies`). Put everything in `dependencies`.",
        "- No `npx`, no `git` binary (use git_* tools), no `python`, no `make`, no `curl`.",
      ].join("\n")
    : [
        "Process model: REAL. `bash` spawns host OS processes.",
        "- Real PATH lookup, real fork/exec. npm/node/git behave as on a developer machine.",
      ].join("\n");
  const netLine = caps.realNetwork
    ? "Network: real TCP/UDP available. `fetch`, custom protocols, raw sockets all work."
    : "Network: NO raw sockets. Only `fetch()` over the host bridge. No postgres/redis/mongo clients.";
  const persistLine = caps.persistence === "durable"
    ? "Filesystem persists across restarts."
    : "Filesystem is session-scoped — state is lost on tab close / process exit.";
  return [
    "You are a coding agent operating inside a piebox sandbox.",
    `Filesystem: ${caps.fileSystem === "vfs" ? "in-memory virtual" : "real host disk"}. ${persistLine}`,
    shimGuidance,
    netLine,
    `Native addons: ${caps.nativeAddons ? "available" : "NOT available — use pure-JS alternatives"}.`,
    `Available host binaries: ${bins}.`,
    "",
    "Use the provided tools. One tool call per turn until you've seen the result.",
    "After every bash call, READ the result. Non-zero exit, 'Error:', 'command not found',",
    "'Cannot find module', 'SyntaxError', 'AssertionError' all mean FAILURE — do not declare success.",
    "Never fabricate tool output. The host UI shows real outputs side-by-side with your claims.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// Driver
// ─────────────────────────────────────────────────────────────────────

export interface AgentDriverOptions {
  sandbox: Sandbox;
  toolset: PieboxToolset;
  llm: LlmClient;
  systemPromptBuilder?: (caps: RuntimeCapabilities) => string;
  maxIterations?: number;
}

export interface AgentDriver {
  submit(prompt: string, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

export function createAgentDriver(opts: AgentDriverOptions): AgentDriver {
  const { sandbox, toolset, llm } = opts;
  const buildSystemPrompt = opts.systemPromptBuilder ?? defaultSystemPromptBuilder;
  const maxIterations = opts.maxIterations ?? 16;

  // Multi-turn history. Carries user msgs and assistant msgs with the
  // toolCalls they made (incl. result JSON) so subsequent turns see
  // the model's prior activity — the issue we hit in useAgentLoop.
  const history: ChatMessage[] = [];
  let turnCounter = 0;

  // Cache capabilities — they don't change mid-session (see E §"open questions").
  const caps = sandbox.runtime.capabilities;
  const systemPrompt = buildSystemPrompt(caps);

  const toolsByName = new Map<string, PieboxTool>();
  for (const t of toolset.tools) toolsByName.set(t.name, t);

  const toolSpecs: ChatToolSpec[] = toolset.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));

  async function* submit(prompt: string, signal: AbortSignal): AsyncIterable<AgentEvent> {
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

      const req: ChatRequest = {
        messages: [{ role: "system", text: systemPrompt }, ...history],
        tools: toolSpecs,
      };

      const pendingCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
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
              pendingCalls.push({ id: chunk.id, name: chunk.name, args: chunk.args });
              break;
            case "turn_complete":
              if (chunk.usage) {
                usage = { tokensIn: chunk.usage.promptTokens, tokensOut: chunk.usage.completionTokens };
              }
              break;
            case "error":
              yield { kind: "error", message: chunk.message };
              return;
          }
        }
      } catch (e) {
        yield { kind: "error", message: e instanceof Error ? e.message : String(e) };
        return;
      }

      // Persist the assistant turn (text + tool calls so far) before
      // running tools. We'll patch in resultJson per-call as they finish.
      const assistantMsg: ChatMessage = {
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
        yield { kind: "turn_completed", turn, usage };
        yield { kind: "completed" };
        return;
      }

      for (const call of pendingCalls) {
        if (signal.aborted) {
          yield { kind: "error", message: "aborted" };
          return;
        }
        yield { kind: "tool_started", callId: call.id, name: call.name, args: call.args };
        const tool = toolsByName.get(call.name);
        let result: PieboxResult;
        if (!tool) {
          result = { ok: false, summary: `unknown tool: ${call.name}` };
        } else {
          try {
            if (tool.executeStreaming) {
              // Stream stdout/stderr through the thinking channel — the
              // playground's terminal store consumed those chunks in the
              // existing impl. `thinking` is the closest existing event;
              // a dedicated tool_stdout event would be cleaner.
              // TODO: layer2 missing — no "tool stdout/stderr stream" event
              //   on AgentEvent. For now reuse `thinking` for live chunks.
              result = await tool.executeStreaming(call.args, sandbox, signal, (text, _stream) => {
                // Cannot yield from inside this callback (sync). Buffer
                // would require a queue; skipping live forward for spike.
              });
            } else {
              result = await tool.execute(call.args, sandbox, signal);
            }
          } catch (e) {
            result = { ok: false, summary: e instanceof Error ? e.message : String(e) };
          }
        }
        yield { kind: "tool_finished", callId: call.id, name: call.name, result };

        // Patch the assistant message's tool call with the result so the
        // next iteration / next submit sees it.
        const patched = assistantMsg.toolCalls?.map((tc) =>
          tc.id === call.id ? { ...tc, resultJson: safeJsonStringify({ ok: result.ok, summary: result.summary, data: result.data }) } : tc,
        );
        assistantMsg.toolCalls = patched;

        // Also append a `tool` message so providers that prefer that
        // shape (vs embedded toolCalls) see the result.
        history.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          text: result.summary ?? (result.ok ? "ok" : "failed"),
        });
      }
      // Loop: model gets another chance to act on the tool results.
    }

    yield { kind: "error", message: `max iterations (${maxIterations}) exceeded` };
  }

  return { submit };
}

function safeJsonStringify(v: unknown): string {
  try { return JSON.stringify(v ?? null); } catch { return "null"; }
}

/*
## Layer 2 gaps surfaced by this spike

1. **No tool stdout/stderr streaming event on the driver's output.**
   `PieboxTool.executeStreaming` exists and takes an `onChunk(text, stream)`
   callback, but the driver has nowhere to forward those chunks: `AgentEvent`
   has `text` (assistant tokens) and `thinking` (model reasoning) but no
   `tool_stdout` / `tool_stderr` event. The existing playground forwarded
   bash stdout to a Terminal tab — that wire is lost here. Either:
     (a) add `{ kind: 'tool_stdout', callId, stream, chunk }` to AgentEvent
         (driver concern, fine), OR
     (b) reshape executeStreaming so the driver can `yield*` from it (e.g.
         return an AsyncIterable instead of taking a callback). Option (b)
         composes better with async generators — current callback shape
         forces the driver to buffer into a queue to bridge sync→async.

2. **No way to read or refresh capabilities mid-session.**
   `sandbox.runtime.capabilities` is read-only at construction. The default
   prompt builder caches the result — fine for the static case. But if a
   future driver wants "user just plugged in a Python binary, re-template
   the prompt," there's no event. Not blocking the spike; flagging.

3. **No sandbox lifecycle hook for "session started" / "session ending."**
   The driver wants to:
     - run setup once (cache caps, build prompt, index tools) — done at
       `createAgentDriver` time, OK.
     - release resources on `submit` completion or abort — currently relies
       on the caller to invoke `sandbox.destroy()`. Multi-submit drivers
       (this one) MUST NOT destroy the sandbox between turns. The contract
       doesn't say so; a `sandbox.acquire()` / `release()` pair, or an
       explicit ownership note in the docstring, would prevent footguns.

4. **No `tool.parameters` ↔ `inputSchema` naming convergence.**
   Layer 2 calls it `inputSchema`; the agent SDK / Gemini provider call it
   `parameters`. Trivial mapping (`parameters: t.inputSchema`), but worth
   noting so the MCP and CLI spikes don't each re-invent the rename. MCP
   actually wants `inputSchema`, so the Layer 2 choice biases toward MCP —
   agent drivers pay a one-line tax. Acceptable.

5. **`ChatMessage` shape on the LLM side is driver-internal, but the
   *content* of `toolCalls.argsJson` / `resultJson` is a shape only this
   driver knows.** Layer 2 doesn't dictate how prior tool activity is
   threaded back into the LLM. That's correct — it's driver-private — but
   the spike had to invent the JSON-string-embedded-in-message pattern from
   scratch. A note in `PieboxTool` doc that "the result is safe to JSON-
   stringify and replay" would be reassuring; today nothing forbids a tool
   from returning a `Uint8Array` or a circular structure in `.data`.

6. **No standard "abort already propagated to in-flight tool" semantics.**
   The driver passes `signal` to `tool.execute`, but Layer 2 doesn't say
   whether tools are required to honor the abort promptly, or whether
   `execute` may return a partial result after abort. The spike treats
   abort as "stop emitting events and return error"; the tool's promise
   keeps running in the background, leaking work. Document the contract
   (must reject promptly? best-effort?) or add `sandbox.abortAllTools()`.

7. **No way to scope the toolset to a subset.**
   `createStandardToolset(sandbox)` returns all tools. The agent driver
   has no driver-level filter ("don't expose git tools to this session").
   Drivers can filter manually by constructing a `PieboxToolset` wrapper,
   which is fine — but worth noting that this is the expected pattern, not
   a missing API.
*/
