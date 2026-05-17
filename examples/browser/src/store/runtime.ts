// Holds the lazily-constructed almostnode container + piebox runtime/fs.
// Built once on first access; the Service Worker bridge is initialized
// here too so in-sandbox HTTP servers can be reached by the Preview iframe.
//
// Lazy so the heavy almostnode boot doesn't run until the user actually
// needs the runtime (sends a prompt, hits Run, etc.). React renders
// before the runtime is needed; this avoids blocking first paint.
import { createContainer } from 'almostnode';
import { createBrowserFs, createBrowserRuntime } from 'piebox/browser';
import type { PieboxFS, PieboxRuntime } from 'piebox/browser';
import { termLog } from './terminal.js';

type Container = ReturnType<typeof createContainer>;

interface RuntimeBundle {
  container: Container;
  fs: PieboxFS;
  runtime: PieboxRuntime;
}

let bundle: RuntimeBundle | null = null;
const listeners = new Set<(port: number, url: string) => void>();

// Known servers, keyed by port (latest URL wins on re-bind). The
// container fires `server-ready` once per bind; subscribers who mount
// AFTER that fire would otherwise miss it forever. We keep a small
// buffer here and replay it to every new listener on subscribe.
//
// Concrete bug this fixes: PreviewPane lives in a tab that's NOT the
// default (WorkspacePanel defaults to 'editor'). The user runs `vite`,
// server-ready fires, then they click Preview — PreviewPane mounts,
// calls onServerReady(), and gets nothing because the event already
// flushed. Now: replay-on-subscribe surfaces the server immediately.
const knownServers = new Map<number, string>();

export function getKnownServers(): Array<{ port: number; url: string }> {
  return Array.from(knownServers, ([port, url]) => ({ port, url }));
}

function buildBundle(): RuntimeBundle {
  termLog('constructing almostnode container…', { tag: 'boot' });
  const container = createContainer({
    onConsole: (level, ...args) => {
      const text = args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
      termLog(text, {
        level: level === 'error' || level === 'warn' ? level : 'info',
        tag: `console:${level}`,
      });
    },
  });
  const fs = createBrowserFs({ source: container.vfs });
  const runtime = createBrowserRuntime({ container });

  container.on('server-ready', (...args: unknown[]) => {
    const port = args[0] as number;
    const url = args[1] as string;
    termLog(`server ready on :${port} → ${url}`, { tag: 'preview' });
    // Record before fanning out so getKnownServers() reflects the new
    // entry inside any listener that re-queries on receipt.
    knownServers.set(port, url);
    for (const cb of listeners) cb(port, url);
  });

  void (async () => {
    try {
      const sw = (container as { serverBridge?: { initServiceWorker?: () => Promise<void> } })
        .serverBridge;
      if (sw?.initServiceWorker) await sw.initServiceWorker();
    } catch (e) {
      termLog(`SW init failed (preview may not work): ${String(e)}`, { level: 'warn', tag: 'boot' });
    }
  })();

  termLog('ready — main-thread / trusted mode', { tag: 'boot' });
  // Expose the live bundle to Playwright-driven probes (scripts/probe-*.mjs)
  // so they can reach into the VFS to verify what the substrate actually
  // wrote — e.g. inspecting Vite's bundled config or post-install
  // node_modules. Cheap and side-effect-free for normal users; only the
  // probes look at it. Done here (not in main.tsx) because the runtime is
  // built lazily on first use, and the probes need the live container, not
  // an undefined placeholder set at mount time.
  (window as unknown as { __piebox?: unknown }).__piebox = { container, fs, runtime };
  return { container, fs, runtime };
}

export function getRuntime(): RuntimeBundle {
  if (!bundle) bundle = buildBundle();
  return bundle;
}

export function onServerReady(cb: (port: number, url: string) => void): () => void {
  listeners.add(cb);
  // Replay any servers that bound before this subscriber arrived. Fires
  // synchronously inside add() — late subscribers see the same state
  // they would have if they had subscribed before the binds happened.
  for (const [port, url] of knownServers) cb(port, url);
  return () => listeners.delete(cb);
}
