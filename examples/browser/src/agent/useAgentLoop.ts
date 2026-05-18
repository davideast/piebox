// Drives one agent submission per send(). Subscribes to the AgentEvent
// stream from @piebox/driver-agent and mirrors its data into the chat +
// terminal stores so the React UI can render reactively.
//
// Multi-turn handling: pre-Step-4 the SDK's session dropped tool calls
// and tool results when it appended assistant messages to its internal
// history, so this hook had to rebuild a fresh session per submit and
// re-thread the prior turns. @piebox/driver-agent now owns history
// internally — the driver keeps the user/assistant/tool messages
// (including each turn's toolCalls + result JSON) so subsequent submits
// see the model's prior activity automatically. The driver handle is
// memoized per (apiKey, modelId) so the history actually persists.
//
// Tool calls' stdout/stderr (bash) AND read/ls payloads stream into the
// Terminal tab so users can watch what's happening in the sandbox. The
// chat store keeps the structured per-tool record for the Activity tab.
import { useCallback, useMemo, useRef } from 'react';
import type { AgentEvent } from '@piebox/driver-agent';
import { buildAgent, type AgentHandle } from '../agent.js';
import { useApiKeyStore } from '../store/apiKey.js';
import { useChatStore, type ToolCall } from '../store/chat.js';
import { useModelStore } from '../store/model.js';
import { useSessionStore } from '../store/session.js';
import { termLog } from '../store/terminal.js';
import { getRuntime } from '../store/runtime.js';

const CWD = '/work';

interface UseAgentLoopReturn {
  send(prompt: string): Promise<void>;
  stop(): void;
}

// Module-scoped so stop() can reach into the in-flight abort without
// React re-render gymnastics.
let currentAbort: AbortController | null = null;

export function useAgentLoop(): UseAgentLoopReturn {
  const apiKey = useApiKeyStore((s) => s.key);
  const modelId = useModelStore((s) => s.modelId);

  // Cache the driver handle across submits so its internal history
  // persists. Rebuilt only when (apiKey, modelId) changes — different
  // keys/models mean a different agent identity.
  const handleRef = useRef<{
    key: string;
    modelId: string;
    handle: AgentHandle;
  } | null>(null);

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

      const cached = handleRef.current;
      let handle: AgentHandle;
      if (cached && cached.key === apiKey && cached.modelId === modelId) {
        handle = cached.handle;
      } else {
        handle = buildAgent({ fs, runtime, cwd: CWD, apiKey, modelId });
        handleRef.current = { key: apiKey, modelId, handle };
      }

      const chat = useChatStore.getState();
      const sess = useSessionStore.getState();

      chat.append({
        id: `u-${crypto.randomUUID()}`,
        role: 'user',
        text: trimmed,
        createdAt: Date.now(),
      });

      const ac = new AbortController();
      currentAbort = ac;
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
        for await (const ev of handle.driver.submit(trimmed, ac.signal)) {
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
      }
    },
    [apiKey, modelId],
  );

  const stop = useCallback(() => {
    currentAbort?.abort();
  }, []);

  return useMemo(() => ({ send, stop }), [send, stop]);
}

function handleEvent(ev: AgentEvent, ensureAssistant: () => string): void {
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
      const inTokens = ev.usage?.tokensIn ?? 0;
      const outTokens = ev.usage?.tokensOut ?? 0;
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
