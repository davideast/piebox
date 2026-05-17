// Ported from firebase-agent-sdk/examples/playground-next/src/components/
// TopBar.tsx, brand swapped to "piebox" and Save action dropped — no
// session-export surface here yet.
import type { ReactNode } from 'react';

export type SessionState = 'idle' | 'streaming' | 'failed';

interface TopBarProps {
  title?: string;
  sessionState?: SessionState;
  onOpenKeys?: () => void;
  /** Copy the current session (chat + terminal) as markdown to the
   *  clipboard. Surfaced as a button next to the key icon so it's
   *  always one click away when debugging. */
  onCopySession?: () => void;
  /** Clear chat history, terminal, and session counters so the next
   *  prompt starts a fresh multi-turn conversation. Disabled (hidden)
   *  while a turn is streaming so the abort path stays simple. */
  onNewChat?: () => void;
  /** True while a turn is in flight — used to disable the "New chat"
   *  button so it doesn't race the active stream. */
  newChatDisabled?: boolean;
  /** Slot rendered before the action icons — used for the model picker
   *  on desktop. Hidden on mobile via the consumer (`hidden md:flex`)
   *  because the TopBar there is tight; mobile users get the picker
   *  inside the key modal instead. */
  children?: ReactNode;
}

export function TopBar({
  title,
  sessionState,
  onOpenKeys,
  onCopySession,
  onNewChat,
  newChatDisabled = false,
  children,
}: TopBarProps) {
  return (
    <header
      className="bg-sidebar-bg border-b border-[#2a2a35] flex items-center justify-between px-4 shrink-0 z-30"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        minHeight: 'calc(52px + env(safe-area-inset-top))',
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2.5">
          <span
            className="material-symbols-outlined text-[20px] text-soft-white/70"
            aria-hidden
          >
            terminal
          </span>
          <span className="text-soft-white/70 text-[13px] font-mono tracking-[-0.02em]">
            piebox
          </span>
        </div>
        {title ? (
          <>
            <span className="hidden sm:inline-block h-4 w-px bg-[#2a2a32] shrink-0" />
            <span className="hidden sm:inline text-soft-white text-[13px] font-medium truncate">
              {title}
            </span>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-4 shrink-0">
        {children}

        {sessionState === 'failed' ? (
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-red-500">close</span>
            <span className="text-slate-gray text-xs font-medium">Failed</span>
          </span>
        ) : null}

        <div className="flex items-center gap-1">
          {onNewChat ? (
            <button
              type="button"
              onClick={onNewChat}
              disabled={newChatDisabled}
              title={newChatDisabled ? 'Stop the current turn first' : 'Start a new chat (clear history)'}
              data-testid="new-chat"
              className="text-slate-gray hover:text-soft-white transition-colors p-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[18px]">edit_square</span>
            </button>
          ) : null}
          {onCopySession ? (
            <button
              type="button"
              onClick={onCopySession}
              title="Copy session as markdown"
              className="text-slate-gray hover:text-soft-white transition-colors p-1.5 rounded"
            >
              <span className="material-symbols-outlined text-[18px]">content_copy</span>
            </button>
          ) : null}
          {onOpenKeys ? (
            <button
              type="button"
              onClick={onOpenKeys}
              title="API key"
              className="text-slate-gray hover:text-soft-white transition-colors p-1.5 rounded"
            >
              <span className="material-symbols-outlined text-[18px]">key</span>
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
