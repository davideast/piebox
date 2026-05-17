// Drives one agent submission per send(). Subscribes to the SessionEvent
// stream from @inbrowser/agent and mirrors its data into the chat + terminal
// stores so the React UI can render reactively.
//
// Tool calls' stdout/stderr (bash) AND read/ls payloads stream into the
// Terminal tab so users can watch what's happening in the sandbox. The
// chat store keeps the structured per-tool record for the Activity tab.
import { useCallback, useRef, useMemo } from 'react';
import type { AgentSession, SessionEvent } from '@inbrowser/agent';
import { buildAgent } from '../agent.js';
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

export function useAgentLoop(): UseAgentLoopReturn {
  const sessionRef = useRef<AgentSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const apiKey = useApiKeyStore((s) => s.key);
  const modelId = useModelStore((s) => s.modelId);

  // Lazily build the session the first time a prompt is sent. Re-built when
  // the API key OR model changes (invalidated below).
  const getSession = useCallback((): AgentSession | null => {
    if (!apiKey) return null;
    if (sessionRef.current) return sessionRef.current;
    const { fs, runtime } = getRuntime();
    try {
      fs.mkdirSync(CWD, { recursive: true });
    } catch {
      /* /work already there */
    }
    const handle = buildAgent({ fs, runtime, cwd: CWD, apiKey, modelId });
    sessionRef.current = handle.session;
    return handle.session;
  }, [apiKey, modelId]);

  // Invalidate the cached session when either input changes — both flow
  // into buildAgent and a stale session would keep pointing at the old
  // model/key for the rest of the user's session.
  const lastKeyRef = useRef<string | null>(apiKey);
  const lastModelRef = useRef<string>(modelId);
  if (lastKeyRef.current !== apiKey || lastModelRef.current !== modelId) {
    lastKeyRef.current = apiKey;
    lastModelRef.current = modelId;
    sessionRef.current = null;
  }

  const send = useCallback(
    async (prompt: string) => {
      const session = getSession();
      if (!session) {
        useSessionStore.getState().setError('API key required — open the key icon, paste a Gemini key, save.');
        return;
      }
      const trimmed = prompt.trim();
      if (!trimmed) return;

      const chat = useChatStore.getState();
      const sess = useSessionStore.getState();

      chat.append({
        id: `u-${crypto.randomUUID()}`,
        role: 'user',
        text: trimmed,
        createdAt: Date.now(),
      });

      const ac = new AbortController();
      abortRef.current = ac;
      sess.setError(null);
      sess.setSending(true);

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
        abortRef.current = null;
      }
    },
    [getSession],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current?.cancel();
  }, []);

  return useMemo(() => ({ send, stop }), [send, stop]);
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
