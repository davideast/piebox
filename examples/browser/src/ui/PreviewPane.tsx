// Workspace > Preview tab — iframe that mirrors in-sandbox HTTP servers.
// When something inside almostnode calls http.createServer().listen(),
// the runtime store fires onServerReady; we capture the most recent URL
// and load it. Reload button forces an iframe re-navigation so a
// recompiled server's output is picked up.
import { useEffect, useState } from 'react';
import { EmptyState } from '@pyric/ui/agents';
import { onServerReady, getRuntime, getKnownServers } from '../store/runtime.js';

interface PreviewServer {
  port: number;
  url: string;
}

export function PreviewPane() {
  // Calling getRuntime() here forces the lazy boot the first time the
  // user opens the Preview tab — even before they send a prompt. This
  // installs the server-ready listener so a manual sandbox HTTP server
  // (run from a future "Run" button or the agent) shows up here.
  useEffect(() => {
    getRuntime();
  }, []);

  // Hydrate from the runtime store's known-servers buffer on first
  // render. WorkspacePanel unmounts this component when the user
  // switches to the Editor tab, so re-opening Preview would otherwise
  // start from an empty list and flash "No preview yet" even when a
  // server is already up. The buffer also covers the "server bound
  // before this tab was ever opened" case (typical when the user
  // watches the Editor while the agent installs deps + starts vite).
  const [servers, setServers] = useState<PreviewServer[]>(() => getKnownServers());
  const [activePort, setActivePort] = useState<number | null>(() => {
    const initial = getKnownServers();
    return initial.length > 0 ? initial[initial.length - 1].port : null;
  });
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    return onServerReady((port, url) => {
      setServers((prev) => {
        const without = prev.filter((s) => s.port !== port);
        return [...without, { port, url }];
      });
      setActivePort(port);
    });
  }, []);

  const active = servers.find((s) => s.port === activePort) ?? null;

  if (!active) {
    return (
      <div className="flex-1 flex items-center justify-center bg-content-bg">
        <EmptyState
          icon={<span className="material-symbols-outlined">play_circle</span>}
          title="No preview yet"
          body="Ask the agent to scaffold and run a dev server (e.g. `npm create vite@latest . -- --template react-ts` then start vite). The iframe will fire up here as soon as a server binds."
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-content-bg">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#2a2a35] bg-sidebar-bg shrink-0">
        {servers.map((s) => (
          <button
            key={s.port}
            type="button"
            onClick={() => setActivePort(s.port)}
            className={[
              'px-2 py-0.5 text-[11px] font-mono rounded transition-colors',
              s.port === activePort
                ? 'bg-[#2a2a35] text-soft-white'
                : 'text-slate-gray hover:text-soft-white hover:bg-[#1a1a22]',
            ].join(' ')}
          >
            :{s.port}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] font-mono text-slate-gray/70 truncate max-w-[40ch]">
          {active.url}
        </span>
        <button
          type="button"
          onClick={() => setReloadTick((n) => n + 1)}
          title="Reload preview"
          className="text-slate-gray hover:text-soft-white transition-colors px-1.5"
        >
          <span className="material-symbols-outlined text-[14px]">refresh</span>
        </button>
      </div>
      <iframe
        key={`${active.port}:${reloadTick}`}
        src={active.url}
        className="flex-1 w-full bg-white"
        title={`preview :${active.port}`}
      />
    </div>
  );
}
