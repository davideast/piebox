// Chat / activity store. Mirrors the shape used in playground-next so the
// Activity tab can group by turn. One user message starts a turn; assistant
// messages append into that turn's response list.
//
// Keeps only the data the UI cares about — agent loop wiring lives in
// useAgentLoop. Tool calls are tracked per-assistant-message so the
// Activity tab can render a fold for each call.
import { create } from 'zustand';

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  status: 'pending' | 'ok' | 'failed';
  summary?: string;
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: number;
  toolCalls?: ToolCall[];
  /** Set on assistant turn completion. */
  metrics?: { tokensIn: number; tokensOut: number };
}

interface ChatState {
  messages: ChatMessage[];
  append(message: ChatMessage): void;
  appendChunk(messageId: string, chunk: string): void;
  upsertToolCall(messageId: string, call: ToolCall): void;
  setToolResult(messageId: string, callId: string, patch: Partial<ToolCall>): void;
  setMetrics(messageId: string, metrics: { tokensIn: number; tokensOut: number }): void;
  reset(): void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  append(message) {
    set((s) => ({ messages: [...s.messages, message] }));
  },
  appendChunk(messageId, chunk) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, text: m.text + chunk } : m,
      ),
    }));
  },
  upsertToolCall(messageId, call) {
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const existing = m.toolCalls ?? [];
        const idx = existing.findIndex((c) => c.id === call.id);
        const next = idx >= 0
          ? existing.map((c, i) => (i === idx ? { ...c, ...call } : c))
          : [...existing, call];
        return { ...m, toolCalls: next };
      }),
    }));
  },
  setToolResult(messageId, callId, patch) {
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const calls = m.toolCalls?.map((c) =>
          c.id === callId ? { ...c, ...patch } : c,
        );
        return calls ? { ...m, toolCalls: calls } : m;
      }),
    }));
  },
  setMetrics(messageId, metrics) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, metrics } : m,
      ),
    }));
  },
  reset() {
    set({ messages: [] });
  },
}));
