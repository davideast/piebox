// React entry. Mounts the playground shell — boots almostnode lazily
// inside the runtime store on first access.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlaygroundPage } from './ui/PlaygroundPage.js';
import { useChatStore } from './store/chat.js';
import { useSessionStore } from './store/session.js';
import { useTerminalStore } from './store/terminal.js';
import { useVfsRevisionStore } from './store/vfs-revision.js';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root mount missing from index.html');

// Test seam for Playwright probes (scripts/probe-*.mjs). Mirrors the
// `window.__piebox` pattern in store/runtime.ts — same shape, set at
// mount time so probes don't have to wait for the almostnode runtime to
// initialize before they can drive the chat surface.
//
// Step 4 note: pre-Step-4 this seam exposed `toSdkHistory` so probes
// could validate the React-store→SDK-history conversion without
// booting an LLM call. That conversion no longer exists — the agent
// driver (@piebox/driver-agent) now owns its multi-turn history
// internally. Probes that depended on `toSdkHistory` need to switch
// to validating driver output instead. See
// scripts/probe-multi-turn.mjs for the migration path.
(window as unknown as { __piebox_test?: unknown }).__piebox_test = {
  stores: {
    chat: useChatStore,
    session: useSessionStore,
    terminal: useTerminalStore,
    vfs: useVfsRevisionStore,
  },
};

createRoot(root).render(
  <StrictMode>
    <PlaygroundPage />
  </StrictMode>,
);
