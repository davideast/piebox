// Drives one agent submission per send(). Subscribes to the SessionEvent
// stream from @inbrowser/agent and mirrors its data into the chat + terminal
// stores so the React UI can render reactively.
//
// Multi-turn handling: the SDK's session only carries assistant *text*
// across submits — it drops tool calls and tool results when it appends
// the assistant message to its internal history. To give the model a
// complete transcript on turn N+1 (including what it wrote, ran, and
// observed), we keep history in useChatStore and rebuild a fresh
// AgentSession on every send with the full accumulated history threaded
// in. Cheap — session construction is just object wiring.
//
// Tool calls' stdout/stderr (bash) AND read/ls payloads stream into the
// Terminal tab so users can watch what's happening in the sandbox. The
// chat store keeps the structured per-tool record for the Activity tab.
import { useCallback, useMemo } from 'react';
import type { ChatMessage as SdkChatMessage, SessionEvent } from '@inbrowser/agent';
import { buildAgent } from '../agent.js';
import { useApiKeyStore } from '../store/apiKey.js';
import { useChatStore, type ChatMessage, type ToolCall } from '../store/chat.js';
import { useModelStore } from '../store/model.js';
import { useSessionStore } from '../store/session.js';
import { termLog } from '../store/terminal.js';
import { getRuntime } from '../store/runtime.js';

const CWD = '/work';

interface UseAgentLoopReturn {
  send(prompt: string): Promise<void>;
  stop(): void;
}

// Module-scoped so stop() can reach into the in-flight session/abort
// without React re-render gymnastics.
let currentAbort: AbortController | null = null;
let currentCancel: (() => void) | null = null;

export function useAgentLoop(): UseAgentLoopReturn {
  const apiKey = useApiKeyStore((s) => s.key);
  const modelId = useModelStore((s) => s.modelId);

  const send = useCallback(
    async (prompt: string) => {
      if (!apiKey) {
        useSessionStore
          .getState()
          .setError('API key required — open the key icon, paste a Gemini key, save.');
        return;
      }
      const trimmed = prompt.trim();
      if (!trimmed) return;

      const { fs, runtime } = getRuntime();
      try {
        fs.mkdirSync(CWD, { recursive: true });
      } catch {
        /* /work already there */
      }

      // Snapshot history BEFORE the new user message hits the chat store.
      // The SDK's session.submit() appends the user prompt to its own
      // history internally, so we must NOT include it here or it would
      // duplicate.
      const prior = useChatStore.getState().messages;
      const history = toSdkHistory(prior);

      const chat = useChatStore.getState();
      const sess = useSessionStore.getState();

      chat.append({
        id: `u-${crypto.randomUUID()}`,
        role: 'user',
        text: trimmed,
        createdAt: Date.now(),
      });

      const handle = buildAgent({ fs, runtime, cwd: CWD, apiKey, modelId, history });
      const session = handle.session;

      const ac = new AbortController();
      currentAbort = ac;
      currentCancel = () => session.cancel();
      sess.setError(null);
      sess.setSending(true);
      // Start in `llm` phase so the Stop button (LLM-only) is visible
      // immediately. Tool phases flip in/out via handleEvent below.
      sess.setPhase('llm');

      let assistantId: string | null = null;
      const ensureAssistant = (): string => {
        if (assistantId) return assistantId;
        assistantId = `a-${crypto.randomUUID()}`;
        useChatStore.getState().append({
          id: assistantId,
          role: 'assistant',
          text: '',
          createdAt: Date.now(),
        });
        return assistantId;
      };

      try {
        for await (const ev of session.submit(trimmed, ac.signal) as AsyncIterable<SessionEvent>) {
          handleEvent(ev, ensureAssistant);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        useSessionStore.getState().setError(msg);
        termLog(msg, { level: 'error', tag: 'session' });
      } finally {
        useSessionStore.getState().setSending(false);
        useSessionStore.getState().setPhase('idle');
        if (currentAbort === ac) currentAbort = null;
        currentCancel = null;
      }
    },
    [apiKey, modelId],
  );

  const stop = useCallback(() => {
    currentAbort?.abort();
    currentCancel?.();
  }, []);

  return useMemo(() => ({ send, stop }), [send, stop]);
}

/** Convert our React chat store into the SDK's ChatMessage shape.
 *  Crucial: assistant messages must carry `toolCalls` (with argsJson +
 *  resultJson) so the LLM sees its own past tool activity. Without this
 *  the SDK's history only carries plain text and the model can't recall
 *  what it created/ran in earlier turns.
 *
 *  Exported so Playwright probes (scripts/probe-*.mjs) can validate the
 *  conversion without booting an LLM call. */
export function toSdkHistory(messages: readonly ChatMessage[]): SdkChatMessage[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m): SdkChatMessage => {
      if (m.role === 'user') {
        return {
          id: m.id,
          role: 'user',
          text: m.text,
          timestamp: m.createdAt,
        };
      }
      return {
        id: m.id,
        role: 'assistant',
        text: m.text,
        timestamp: m.createdAt,
        ...(m.toolCalls && m.toolCalls.length > 0
          ? { toolCalls: m.toolCalls.map(toSdkToolCall) }
          : {}),
      };
    });
}

function toSdkToolCall(call: ToolCall): SdkChatMessage['toolCalls'] extends Array<infer T> | undefined ? T : never {
  // Serialize args/result to JSON for the SDK shape. Tool results that
  // failed to serialize (cyclic refs, etc.) fall back to a stub so the
  // model still sees that a call happened, just without payload.
  let argsJson: string;
  try {
    argsJson = JSON.stringify(call.args ?? {});
  } catch {
    argsJson = '{}';
  }
  let resultJson: string | undefined;
  if (call.result !== undefined) {
    try {
      resultJson = JSON.stringify({
        ok: call.status !== 'failed',
        summary: call.summary,
        data: call.result,
      });
    } catch {
      resultJson = JSON.stringify({ ok: call.status !== 'failed', summary: call.summary });
    }
  } else if (call.summary !== undefined) {
    resultJson = JSON.stringify({ ok: call.status !== 'failed', summary: call.summary });
  }
  return {
    id: call.id,
    name: call.name,
    argsJson,
    ...(resultJson !== undefined ? { resultJson } : {}),
    ok: call.status === 'ok',
    ...(call.summary !== undefined ? { summary: call.summary } : {}),
  } as never;
}

function handleEvent(ev: SessionEvent, ensureAssistant: () => string): void {
  const chat = useChatStore.getState();
  switch (ev.kind) {
    case 'turn_started':
      // Wait for first text/tool to mount the assistant message so
      // empty turns don't clutter the timeline.
      break;
    case 'text': {
      const id = ensureAssistant();
      chat.appendChunk(id, ev.chunk);
      break;
    }
    case 'thinking':
      // Stream thoughts into the terminal too — useful debug, doesn't
      // belong in the chat body. Tag distinguishes from real tool output.
      termLog(ev.chunk, { tag: 'thinking' });
      break;
    case 'tool_started': {
      const id = ensureAssistant();
      const args = (ev.args ?? {}) as Record<string, unknown>;
      const call: ToolCall = {
        id: ev.callId,
        name: ev.name,
        args,
        status: 'pending',
      };
      chat.upsertToolCall(id, call);
      termLog(formatToolStart(ev.name, args), { tag: ev.name });
      // While a tool runs (often a long-lived bash like `next start`),
      // the LLM is not producing tokens. Flip phase so the compose bar
      // hides the Stop button — Stop is for LLM interactions only.
      useSessionStore.getState().setPhase('tool');
      break;
    }
    case 'tool_finished': {
      // Find the assistant message that owns this call to update its
      // status. Linear scan is fine — the list is tiny.
      const owner = useChatStore
        .getState()
        .messages.find((m) => m.toolCalls?.some((c) => c.id === ev.callId));
      if (owner) {
        chat.setToolResult(owner.id, ev.callId, {
          status: ev.result.ok ? 'ok' : 'failed',
          summary: ev.result.summary,
          result: ev.result.data,
        });
      }
      const data = ev.result.data as
        | { stdout?: string; stderr?: string; content?: string; entries?: string[] }
        | undefined;
      const out = (data?.stdout ?? '') + (data?.stderr ?? '');
      if (out.trim()) {
        for (const line of out.split('\n')) {
          if (!line.trim()) continue;
          termLog(line, {
            level: ev.result.ok ? 'info' : 'error',
            tag: 'tool',
          });
        }
      } else if (ev.result.summary) {
        termLog(ev.result.summary, {
          level: ev.result.ok ? 'info' : 'error',
          tag: 'tool',
        });
      }
      // Tool done — the LLM is about to resume (next ReAct iteration)
      // or the strategy will emit turn_completed. Either way, restore
      // the `llm` phase so the Stop button reappears if the model
      // streams more tokens.
      useSessionStore.getState().setPhase('llm');
      break;
    }
    case 'turn_completed': {
      const id = ensureAssistant();
      const inTokens = ev.metrics.tokensIn ?? 0;
      const outTokens = ev.metrics.tokensOut ?? 0;
      chat.setMetrics(id, { tokensIn: inTokens, tokensOut: outTokens });
      useSessionStore.getState().bumpTurn(inTokens + outTokens);
      break;
    }
    case 'error':
      useSessionStore.getState().setError(ev.message);
      termLog(ev.message, { level: 'error', tag: 'error' });
      break;
    case 'completed':
      break;
    default:
      break;
  }
}

function formatToolStart(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'bash':
      return `$ ${String(args.command ?? '')}`;
    case 'write':
      return `write ${String(args.path ?? '?')}`;
    case 'read':
      return `read ${String(args.path ?? '?')}`;
    case 'edit':
      return `edit ${String(args.path ?? '?')}`;
    case 'ls':
      return `ls ${String(args.path ?? '?')}`;
    default:
      return `${name} ${JSON.stringify(args).slice(0, 120)}`;
  }
}
