// Read-only terminal store. Receives lines from anywhere in the app
// (agent tool stdout/stderr, runtime.run output, almostnode container
// console hook, manual log() calls). The Terminal tab subscribes and
// renders them in arrival order.
//
// Severity buckets follow the playground-next vocabulary (info / warn /
// error) so the TerminalView styling lines up cleanly.
import { create } from 'zustand';

export type TerminalLevel = 'info' | 'warn' | 'error';

export interface TerminalLine {
  id: number;
  ts: number;
  level: TerminalLevel;
  tag?: string;
  text: string;
}

interface TerminalState {
  lines: TerminalLine[];
  log(text: string, opts?: { level?: TerminalLevel; tag?: string }): void;
  clear(): void;
}

let nextId = 1;

export const useTerminalStore = create<TerminalState>((set) => ({
  lines: [],
  log(text, opts) {
    const line: TerminalLine = {
      id: nextId++,
      ts: Date.now(),
      level: opts?.level ?? 'info',
      ...(opts?.tag ? { tag: opts.tag } : {}),
      text,
    };
    set((s) => ({ lines: [...s.lines, line] }));
  },
  clear() {
    set({ lines: [] });
  },
}));

// Convenience that any non-React module can import to push lines without
// reaching into the React subtree. Same effect as calling the store action
// directly, just less ceremony at call sites.
export function termLog(text: string, opts?: { level?: TerminalLevel; tag?: string }): void {
  useTerminalStore.getState().log(text, opts);
}
