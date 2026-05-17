// Playground shell — ports the core layout of firebase-agent-sdk/examples/
// playground-next/src/components/PlaygroundPage.tsx, stripped of every
// Firebase- and enhancer-specific surface (sessions modal, settings modal,
// model picker, Firestore tab, Deploy tab, Suggestions tab, denial banner,
// prompt enhancer, redirect-sign-in, page-lifecycle diagnostics).
//
// What remains:
//   - TopBar with brand + key button
//   - Two-pane desktop split (Workspace · Agent), draggable
//   - Mobile: BottomTabBar swaps Workspace/Agent into the full screen
//   - Agent pane has PanelTabs (Activity · Terminal), ComposeBar, StatusBar
//   - The "Output" tab from playground-next is replaced by "Terminal"
//     (read-only terminal stream — see TerminalTab.tsx)
//
// Chat flow is preserved: ComposeBar → useAgentLoop().send → SessionEvent
// stream → chat store + terminal store → ActivityTab + TerminalTab.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToastProvider, useToast } from '@pyric/ui/primitives';
import { useAgentLoop } from '../agent/useAgentLoop.js';
import { buildSessionMarkdown, copyToClipboard } from '../lib/sessionMarkdown.js';
import { useApiKeyStore } from '../store/apiKey.js';
import { useChatStore } from '../store/chat.js';
import { GEMINI_MODELS, useModelStore } from '../store/model.js';
import { useMobileNavStore } from '../store/mobile-nav.js';
import { useSessionStore } from '../store/session.js';
import { useTerminalStore } from '../store/terminal.js';
import { ActivityTab } from './ActivityTab.js';
import { ApiKeyModal } from './ApiKeyModal.js';
import { BottomTabBar } from './BottomTabBar.js';
import { ComposeBar } from './ComposeBar.js';
import { ModelPicker } from './ModelPicker.js';
import { PanelTabs, type Tab } from './PanelTabs.js';
import { ShellTab } from './ShellTab.js';
import { StatusBar } from './StatusBar.js';
import { TerminalTab } from './TerminalTab.js';
import { TopBar } from './TopBar.js';
import { WorkspacePanel } from './WorkspacePanel.js';

const SPLIT_STORAGE_KEY = 'piebox:split-pct';
const SPLIT_DEFAULT = 60;
const SPLIT_MIN = 25;
const SPLIT_MAX = 80;

function readStoredSplit(): number {
  if (typeof window === 'undefined') return SPLIT_DEFAULT;
  const v = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY));
  return Number.isFinite(v) && v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT;
}

// Inner shell is split out so useToast() can resolve against the
// ToastProvider that PlaygroundPage mounts.
export function PlaygroundPage() {
  return (
    <ToastProvider>
      <PlaygroundShell />
    </ToastProvider>
  );
}

function PlaygroundShell() {
  const [activeTab, setActiveTab] = useState<string>('activity');
  const [keysOpen, setKeysOpen] = useState(false);
  const [composeValue, setComposeValue] = useState('');
  const mobileTab = useMobileNavStore((s) => s.activeTab);

  const apiKey = useApiKeyStore((s) => s.key);
  const modelId = useModelStore((s) => s.modelId);
  const modelLabel = useMemo(
    () => GEMINI_MODELS.find((m) => m.id === modelId)?.label ?? modelId,
    [modelId],
  );
  const { send, stop } = useAgentLoop();
  const sending = useSessionStore((s) => s.sending);
  const phase = useSessionStore((s) => s.phase);
  const error = useSessionStore((s) => s.error);
  const turns = useSessionStore((s) => s.turns);
  const tokensTotal = useSessionStore((s) => s.tokensTotal);
  const { toast } = useToast();

  const handleNewChat = useCallback(() => {
    // Best-effort stop in case the user clicks while a turn is still
    // racing (the button is also disabled during sending, but tabs +
    // keyboard shortcuts can still get here). Then clear the surfaces
    // that make this feel like a fresh chat — chat history, terminal
    // stream, session counters, and surfaced error. The /work VFS is
    // left intact on purpose: blowing away the user's project files
    // every time they hit "new chat" would be surprising.
    stop();
    useChatStore.getState().reset();
    useTerminalStore.getState().clear();
    useSessionStore.getState().reset();
    setComposeValue('');
  }, [stop]);

  const handleCopySession = useCallback(async () => {
    const messages = useChatStore.getState().messages;
    const terminal = useTerminalStore.getState().lines;
    const md = buildSessionMarkdown({
      modelLabel: `Gemini ${modelLabel}`,
      turns,
      tokensTotal,
      messages,
      terminal,
    });
    const ok = await copyToClipboard(md);
    if (ok) {
      toast({
        title: 'Session copied',
        body: `${messages.length} message${messages.length === 1 ? '' : 's'} · ${terminal.length} terminal line${terminal.length === 1 ? '' : 's'}`,
        kind: 'success',
      });
      return;
    }
    toast({
      title: 'Copy failed',
      body: 'Clipboard API unavailable. Open devtools and grab `window.__piebox_session_md__` instead.',
      kind: 'error',
    });
    (window as unknown as { __piebox_session_md__?: string }).__piebox_session_md__ = md;
  }, [toast, turns, tokensTotal, modelLabel]);

  // Split-pane drag — copied wholesale from playground-next. Persisted to
  // localStorage; clamped so neither pane disappears.
  const [splitPct, setSplitPct] = useState<number>(readStoredSplit);
  const [isResizing, setIsResizing] = useState(false);
  const draggingRef = useRef(false);
  useEffect(() => {
    try {
      window.localStorage.setItem(SPLIT_STORAGE_KEY, String(splitPct));
    } catch {
      /* localStorage unavailable */
    }
  }, [splitPct]);

  const onResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (clientX: number) => {
      if (!draggingRef.current) return;
      const vw = window.innerWidth;
      const pct = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, (clientX / vw) * 100));
      setSplitPct(pct);
    };
    const onMouseMove = (ev: MouseEvent) => move(ev.clientX);
    const onTouchMove = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (t) move(t.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }, []);

  const rightTabs: readonly Tab[] = useMemo(
    () => [
      { id: 'activity', label: 'Activity' },
      // The interactive xterm.js terminal. Sits where users expect
      // "Terminal" to be — typeable, with a prompt and history. Shares
      // /work with the agent.
      { id: 'shell', label: 'Terminal' },
      // Read-only stream of boot, agent tool stdout/stderr, and any
      // console-level events from the almostnode container. Was the
      // old "Terminal" tab; renamed to "Logs" so the interactive tab
      // can take the more obvious name.
      { id: 'terminal', label: 'Logs' },
    ],
    [],
  );

  const handleSubmit = useCallback(() => {
    const text = composeValue.trim();
    if (!text) return;
    setComposeValue('');
    void send(text);
  }, [composeValue, send]);

  const sessionState: 'idle' | 'streaming' | 'failed' = sending
    ? 'streaming'
    : error
      ? 'failed'
      : 'idle';

  const hasKey = !!apiKey;

  return (
    <>
      <TopBar
        title="playground"
        sessionState={sessionState}
        onOpenKeys={() => setKeysOpen(true)}
        onCopySession={handleCopySession}
        onNewChat={handleNewChat}
        newChatDisabled={sending}
      >
        {/* Desktop carries the picker in the TopBar; mobile hides it
            here (the bar is tight) and re-renders it inside the API
            key modal so the user can switch model + manage keys in
            one place. */}
        <div className="hidden md:flex">
          <ModelPicker />
        </div>
      </TopBar>

      <div
        className="flex-1 overflow-hidden flex"
        style={
          {
            '--split-l': `${splitPct}%`,
            '--split-r': `${100 - splitPct}%`,
          } as React.CSSProperties
        }
      >
        <main
          className={[
            'md:flex md:w-[var(--split-l)] flex-col min-w-0 bg-content-bg border-r border-[#2a2a35]',
            mobileTab === 'workspace' ? 'flex w-full' : 'hidden md:flex',
          ].join(' ')}
        >
          <WorkspacePanel />
        </main>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          tabIndex={-1}
          onMouseDown={onResizeStart}
          onTouchStart={onResizeStart}
          className="hidden md:block w-3 -mx-1.5 shrink-0 cursor-col-resize group relative z-10"
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[#2a2a35] group-hover:bg-[#3a3a48] transition-colors" />
        </div>

        <aside
          className={[
            'md:flex md:w-[var(--split-r)] flex-col min-w-0 bg-sidebar-bg',
            mobileTab === 'agent' ? 'flex w-full' : 'hidden md:flex',
          ].join(' ')}
        >
          <PanelTabs tabs={rightTabs} activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {activeTab === 'activity' ? <ActivityTab /> : null}
            {activeTab === 'terminal' ? <TerminalTab /> : null}
            {activeTab === 'shell' ? <ShellTab /> : null}
          </div>

          <StatusBar
            modelLabel={`Gemini ${modelLabel}`}
            sessionState={sessionState}
            error={error}
            turns={turns}
            tokensTotal={tokensTotal}
          />
          <ComposeBar
            value={composeValue}
            onChange={setComposeValue}
            onSubmit={handleSubmit}
            onStop={stop}
            sending={sending}
            phase={phase}
            disabled={!hasKey}
            placeholder={
              hasKey
                ? 'Ask the agent to scaffold, run, or modify code in the sandbox…'
                : 'Paste a Gemini API key first (top-right key icon)'
            }
          />
        </aside>
      </div>

      {isResizing ? (
        <div className="fixed inset-0 z-[2000] cursor-col-resize" aria-hidden />
      ) : null}

      <BottomTabBar />

      <ApiKeyModal open={keysOpen} onClose={() => setKeysOpen(false)} />
    </>
  );
}
