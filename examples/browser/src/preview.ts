/**
 * PreviewController — surfaces in-sandbox HTTP servers as a live iframe.
 *
 * almostnode's ServerBridge emits 'server-ready' (port, url) whenever any
 * code in the sandbox calls http.createServer().listen(port). That covers
 * plain node:http servers, Hono, Express, AND Vite / Next dev servers,
 * since they all bottom out on node:http.
 *
 * We register one tab per port and show the most recent in the iframe.
 * Multiple servers across a session = multiple tabs the user can switch
 * between (e.g. an api server + a dev server).
 */

interface PreviewServer {
  port: number;
  url: string;
  registeredAt: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<{
    className: string;
    textContent: string;
    dataset: Record<string, string>;
  }> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.textContent !== undefined) node.textContent = props.textContent;
  if (props.dataset) {
    for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  }
  return node;
}

export interface PreviewControllerOptions {
  panel: HTMLElement;
  iframe: HTMLIFrameElement;
  tabs: HTMLElement;
  meta: HTMLElement;
  empty: HTMLElement;
}

export class PreviewController {
  private panel: HTMLElement;
  private iframe: HTMLIFrameElement;
  private tabs: HTMLElement;
  private meta: HTMLElement;
  private empty: HTMLElement;
  private servers: PreviewServer[] = [];
  private activePort: number | null = null;

  constructor(opts: PreviewControllerOptions) {
    this.panel = opts.panel;
    this.iframe = opts.iframe;
    this.tabs = opts.tabs;
    this.meta = opts.meta;
    this.empty = opts.empty;
  }

  /** Called by the 'server-ready' event from almostnode's ServerBridge. */
  onServerReady(port: number, url: string): void {
    // Replace existing entry for the same port (server restart case).
    this.servers = this.servers.filter((s) => s.port !== port);
    this.servers.push({ port, url, registeredAt: Date.now() });
    this.activePort = port; // newest wins
    this.render();
  }

  /** Clear the iframe but keep the panel visible with its empty state. */
  reset(): void {
    this.servers = [];
    this.activePort = null;
    this.iframe.src = "about:blank";
    this.render();
  }

  private render(): void {
    // Tabs: one per port + a reload + a reset button.
    this.tabs.textContent = "";
    for (const s of this.servers) {
      const btn = el("button", {
        textContent: `:${s.port}`,
        className: s.port === this.activePort ? "active" : "",
        dataset: { port: String(s.port) },
      });
      btn.addEventListener("click", () => this.switchTo(s.port));
      this.tabs.appendChild(btn);
    }
    if (this.servers.length > 0) {
      const reload = el("button", { textContent: "↻ reload" });
      reload.addEventListener("click", () => {
        // Cache-busting reload: set the same URL with a fresh query param.
        const active = this.servers.find((s) => s.port === this.activePort);
        if (active) this.iframe.src = `${active.url}?_=${Date.now()}`;
      });
      this.tabs.appendChild(reload);

      const close = el("button", { textContent: "✕ close" });
      close.addEventListener("click", () => this.reset());
      this.tabs.appendChild(close);
    }

    // Iframe + meta line + empty-state toggle.
    const active = this.servers.find((s) => s.port === this.activePort);
    if (active) {
      // Only swap src if it actually changed — prevents an unnecessary reload
      // every time another server registers.
      if (this.iframe.src !== active.url) this.iframe.src = active.url;
      this.meta.textContent = `:${active.port} → ${active.url}`;
      this.iframe.hidden = false;
      this.empty.hidden = true;
    } else {
      this.iframe.src = "about:blank";
      this.iframe.hidden = true;
      this.empty.hidden = false;
      this.meta.textContent = "no servers running";
    }
  }

  private switchTo(port: number): void {
    this.activePort = port;
    this.render();
  }
}
