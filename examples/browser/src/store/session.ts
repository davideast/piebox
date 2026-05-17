// Per-session session-state (sending / error). Kept separate from the
// chat history so timeline re-renders don't pull in the agent loop's
// transient flags.
import { create } from 'zustand';

/** Where the in-flight turn currently sits. `llm` = model is producing
 *  text/thinking/tool_calls; `tool` = a tool handler is executing; `idle`
 *  = no turn in flight. Used by the compose bar to decide whether the
 *  Stop button (LLM-only) should appear or whether to show a less
 *  scary "running tool…" indicator while a long-lived bash (dev
 *  server, fetch loop) blocks the turn from completing. */
export type SessionPhase = 'idle' | 'llm' | 'tool';

interface SessionState {
  sending: boolean;
  phase: SessionPhase;
  error: string | null;
  turns: number;
  tokensTotal: number;
  setSending(v: boolean): void;
  setPhase(p: SessionPhase): void;
  setError(e: string | null): void;
  bumpTurn(tokens: number): void;
  reset(): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sending: false,
  phase: 'idle',
  error: null,
  turns: 0,
  tokensTotal: 0,
  setSending(v) {
    set({ sending: v });
  },
  setPhase(p) {
    set({ phase: p });
  },
  setError(e) {
    set({ error: e });
  },
  bumpTurn(tokens) {
    set((s) => ({ turns: s.turns + 1, tokensTotal: s.tokensTotal + tokens }));
  },
  reset() {
    set({ sending: false, phase: 'idle', error: null, turns: 0, tokensTotal: 0 });
  },
}));
