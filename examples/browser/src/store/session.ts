// Per-session session-state (sending / error). Kept separate from the
// chat history so timeline re-renders don't pull in the agent loop's
// transient flags.
import { create } from 'zustand';

interface SessionState {
  sending: boolean;
  error: string | null;
  turns: number;
  tokensTotal: number;
  setSending(v: boolean): void;
  setError(e: string | null): void;
  bumpTurn(tokens: number): void;
  reset(): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sending: false,
  error: null,
  turns: 0,
  tokensTotal: 0,
  setSending(v) {
    set({ sending: v });
  },
  setError(e) {
    set({ error: e });
  },
  bumpTurn(tokens) {
    set((s) => ({ turns: s.turns + 1, tokensTotal: s.tokensTotal + tokens }));
  },
  reset() {
    set({ sending: false, error: null, turns: 0, tokensTotal: 0 });
  },
}));
