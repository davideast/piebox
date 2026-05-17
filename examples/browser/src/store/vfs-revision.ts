// Monotonic revision counter that anyone can bump to signal "the VFS
// might have changed — anyone displaying its contents should re-read."
//
// The EditorPane's file tree already re-walks when chat-store messages
// or tool calls update (that's how agent-driven writes show up). The
// Shell tab doesn't go through tool calls, so without this signal a
// `mkdir`, `npm install`, or `git init` typed by the user would leave
// the tree stale until the user hit the manual refresh button.
//
// Cheap: in-memory counter, no I/O. Bump after any operation that
// might have mutated the in-memory filesystem; consumers subscribe
// with the standard zustand selector pattern.
import { create } from 'zustand';

interface VfsRevisionState {
  revision: number;
  bump(): void;
}

export const useVfsRevisionStore = create<VfsRevisionState>((set) => ({
  revision: 0,
  bump() {
    set((s) => ({ revision: s.revision + 1 }));
  },
}));

/** Non-React call site (e.g. ShellSession class) bumps without grabbing
 *  the hook. Same effect as `useVfsRevisionStore.getState().bump()`. */
export function bumpVfsRevision(): void {
  useVfsRevisionStore.getState().bump();
}
