// Interactive xterm.js shell tab. The user types real commands here —
// node, npm, ls, git, etc. — and the line buffer hands each one to
// runInSandbox via ShellSession (see ../runtime/shell-session.ts).
//
// The cwd defaults to /work and is shared with the agent's tool calls,
// so files the agent writes show up here and `npm install zod` from the
// user is visible to the agent on its next turn. The shell session is
// lazy: nothing boots until the user actually mounts this tab.
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getRuntime } from '../store/runtime.js';
import { ShellSession } from '../runtime/shell-session.js';

export function ShellTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const sessionRef = useRef<ShellSession | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      // Match the playground's "Jules Ink" palette so the terminal
      // doesn't visually conflict with the rest of the dark UI.
      theme: {
        background: '#0e0e12',
        foreground: '#e4e1e7',
        cursor: '#e4e1e7',
        cursorAccent: '#0e0e12',
        selectionBackground: '#44455b',
        black: '#131317',
        red: '#ffb4ab',
        green: '#a4d4a8',
        yellow: '#e2e2e5',
        blue: '#c5c4df',
        magenta: '#6dfe9c',
        cyan: '#c5c4df',
        white: '#e4e1e7',
      },
      allowProposedApi: true,
      convertEol: false,
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    fitRef.current = fit;

    term.open(host);
    // First fit after open() ensures the terminal sizes to the
    // container before the prompt is drawn. A second fit lands after
    // a microtask in case xterm.js is still computing cell metrics.
    fit.fit();
    queueMicrotask(() => fit.fit());

    const { fs, runtime } = getRuntime();
    const session = new ShellSession(term, { fs, runtime });
    session.start();
    sessionRef.current = session;

    // Resize observer keeps the shell sized to whatever the panel does
    // (tab switches, split-pane drags, browser resize). Cheap.
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* layout race; ignore */ }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      session.dispose();
      term.dispose();
      termRef.current = null;
      sessionRef.current = null;
      fitRef.current = null;
    };
  }, []);

  return (
    <div className="flex-1 min-h-0 bg-[#0e0e12] overflow-hidden">
      <div
        ref={containerRef}
        data-testid="shell-host"
        className="w-full h-full p-2"
      />
    </div>
  );
}
