/**
 * HTMLStreamAdapter — piebox StreamAdapter rendered into the DOM using the
 * Jules Ink design language (see DESIGN.md at the repo root). Each event
 * becomes a timeline entry: a hairline vertical rail with a small dot,
 * monospace header (`BADGE  title  timestamp`), and body content (text,
 * code block with file-path header, bash command + output, metric tiles
 * for session end).
 *
 * Per-session events are accumulated so the session_end card can render
 * a "copy session" button that serialises the whole run to markdown.
 */

import type { StreamEvent } from "piebox/browser";
import type { StreamAdapter } from "piebox/browser";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<{
    className: string;
    textContent: string;
    innerHTML: string;
    dataset: Record<string, string>;
  }> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.textContent !== undefined) node.textContent = props.textContent;
  if (props.innerHTML !== undefined) node.innerHTML = props.innerHTML;
  if (props.dataset) {
    for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  }
  return node;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function langFromPath(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
    json: "json", md: "md", yaml: "yaml", yml: "yaml",
    html: "html", css: "css", sh: "bash",
  };
  return map[ext] ?? "text";
}

export interface HTMLStreamAdapterOptions {
  container: HTMLElement;
  autoScroll?: boolean;
}

export class HTMLStreamAdapter implements StreamAdapter {
  private container: HTMLElement;
  private autoScroll: boolean;
  private currentTextEntry: HTMLElement | null = null;
  private bashEntriesByToolCallId = new Map<string, HTMLElement>();
  // Tool-result outputs are captured here so the markdown serialiser can
  // include them inline next to the bash command card.
  private bashOutputByToolCallId = new Map<string, { output: string; isError: boolean }>();
  private startTs = 0;
  // Per-session event log used to power the copy-to-clipboard button.
  private sessionEvents: StreamEvent[] = [];
  // The session_end card stashes its actions container here so the copy
  // button can be appended in end() — after any FAILED_TOOL_CALLS card or
  // other post-session_end events have been written. Captures the truth.
  private pendingSessionActions: HTMLElement | null = null;

  constructor(options: HTMLStreamAdapterOptions) {
    this.container = options.container;
    this.autoScroll = options.autoScroll ?? true;
  }

  start(): void {
    this.startTs = Date.now();
    this.sessionEvents = [];
    this.bashOutputByToolCallId.clear();
    this.banner(`session started · ${new Date().toLocaleTimeString()}`);
    this.scroll();
  }

  write(event: StreamEvent): void {
    this.sessionEvents.push(event);

    if (event.type !== "text_delta" && this.currentTextEntry) {
      this.currentTextEntry = null;
    }

    switch (event.type) {
      case "thinking": {
        const e = this.entry("thinking", "thinking", "reasoning");
        const body = el("div", { className: "ev-thinking", textContent: event.text });
        e.appendChild(body);
        break;
      }
      case "text_delta": {
        if (!this.currentTextEntry) {
          this.currentTextEntry = this.entry("text", "assistant", "reply");
          const body = el("div", { className: "ev-body" });
          this.currentTextEntry.appendChild(body);
        }
        const body = this.currentTextEntry.querySelector(".ev-body");
        if (body) body.textContent = (body.textContent ?? "") + event.delta;
        break;
      }
      case "file_create": {
        const e = this.entry("file-create", "create", event.path, "add");
        e.appendChild(this.codeBlock(event.path, event.language, event.content));
        break;
      }
      case "file_edit": {
        const e = this.entry("file-edit", "edit", event.path);
        e.appendChild(this.diffBlock(event.path, event.diff));
        break;
      }
      case "bash": {
        const e = this.entry("bash", "bash", event.command, "run");
        const cmd = el("div", { className: "bash-cmd", textContent: `$ ${event.command}` });
        const out = el("div", { className: "bash-output", textContent: "(running…)" });
        e.appendChild(cmd);
        e.appendChild(out);
        this.bashEntriesByToolCallId.set(event.toolCallId, e);
        break;
      }
      case "file_read": {
        this.entry("file-read", "read", event.path, "read");
        break;
      }
      case "file_list": {
        this.entry("file-list", "ls", event.path, "read");
        break;
      }
      case "search": {
        this.entry("search", event.tool, `"${event.query}"`, "read");
        break;
      }
      case "tool_result": {
        this.bashOutputByToolCallId.set(event.toolCallId, {
          output: event.output,
          isError: event.isError,
        });
        const entry = this.bashEntriesByToolCallId.get(event.toolCallId);
        if (entry) {
          const out = entry.querySelector(".bash-output");
          if (out) out.textContent = event.output || "(no output)";
          if (event.isError) entry.classList.add("is-error");
          this.bashEntriesByToolCallId.delete(event.toolCallId);
        }
        break;
      }
      case "session_start": {
        this.banner(`model ${event.model} · cwd ${event.sandbox}`);
        break;
      }
      case "session_end": {
        const e = this.entry("session-end", "done", "session complete");
        e.appendChild(this.metricRow([
          { label: "duration", value: `${(event.durationMs / 1000).toFixed(1)}s` },
          { label: "new", value: String(event.newFiles.length), good: event.newFiles.length > 0 },
          { label: "modified", value: String(event.modifiedFiles.length) },
          { label: "tool calls", value: String(event.toolCalls) },
        ]));
        if (event.newFiles.length || event.modifiedFiles.length) {
          const list = el("pre", { className: "bash-output" });
          const lines: string[] = [];
          for (const p of event.newFiles) lines.push(`+ ${p}`);
          for (const p of event.modifiedFiles) lines.push(`~ ${p}`);
          list.textContent = lines.join("\n");
          e.appendChild(list);
        }
        // Copy-session button is appended in end() so the snapshot includes
        // any events the host writes AFTER session_end (e.g. the
        // FAILED_TOOL_CALLS warning). Stash the container; end() fills it.
        const actions = el("div", { className: "row", dataset: { role: "session-actions" } });
        e.appendChild(actions);
        this.pendingSessionActions = actions;
        break;
      }
      case "error": {
        const e = this.entry("error", event.code, "error", "err");
        e.classList.add("is-error");
        const body = el("pre", { className: "bash-output", textContent: (event as any).message ?? "" });
        e.appendChild(body);
        break;
      }
    }
    this.scroll();
  }

  end(): void {
    const elapsed = ((Date.now() - this.startTs) / 1000).toFixed(2);
    this.banner(`session ended · ${elapsed}s`);

    // Now that all post-session_end events (including FAILED_TOOL_CALLS) have
    // been written, take a final snapshot and wire the copy-session button.
    if (this.pendingSessionActions) {
      const snapshot = this.sessionEvents.slice();
      const copyBtn = el("button", { textContent: "Copy session as markdown" });
      copyBtn.addEventListener("click", () => {
        const md = this.serialiseToMarkdown(snapshot);
        this.copyToClipboard(md, copyBtn);
      });
      this.pendingSessionActions.appendChild(copyBtn);
      this.pendingSessionActions = null;
    }
    this.scroll();
  }

  // ── helpers ───────────────────────────────────────────────────────────
  private entry(
    kind: string,
    badge: string,
    title: string,
    badgeStyle?: "add" | "run" | "read" | "err",
  ): HTMLElement {
    const e = el("div", { className: "ev", dataset: { kind } });
    const head = el("div", { className: "ev-head" });
    const b = el("span", { className: `ev-badge${badgeStyle ? ` ${badgeStyle}` : ""}`, textContent: badge });
    const t = el("span", { className: "ev-title", textContent: title });
    const ts = el("span", { className: "ev-time", textContent: timestamp() });
    head.appendChild(b);
    // Insert literal text-node spaces between siblings so that copy-as-plain-text
    // from the page yields readable output ("create  package.json  23:03:02")
    // rather than concatenated tokens ("createpackage.json23:03:02"). The
    // visual layout is driven by CSS `gap`; the text nodes are only for copy.
    head.appendChild(document.createTextNode(" "));
    head.appendChild(t);
    head.appendChild(document.createTextNode(" "));
    head.appendChild(ts);
    e.appendChild(head);
    this.container.appendChild(e);
    return e;
  }

  private banner(text: string): HTMLElement {
    const b = el("div", { className: "ev", dataset: { kind: "banner" }, textContent: text });
    this.container.appendChild(b);
    return b;
  }

  private codeBlock(path: string, language: string, body: string): HTMLElement {
    const wrap = el("div", { className: "codeblock" });
    const head = el("div", { className: "codeblock-head" });
    head.appendChild(el("span", { textContent: path }));
    head.appendChild(document.createTextNode(" "));
    head.appendChild(el("span", { className: "lang", textContent: language || langFromPath(path) }));
    const pre = el("pre", { textContent: body });
    wrap.appendChild(head);
    wrap.appendChild(pre);
    return wrap;
  }

  private diffBlock(path: string, diff: string): HTMLElement {
    const wrap = el("div", { className: "codeblock" });
    const head = el("div", { className: "codeblock-head" });
    head.appendChild(el("span", { textContent: path }));
    head.appendChild(document.createTextNode(" "));
    head.appendChild(el("span", { className: "lang", textContent: "diff" }));
    const pre = el("pre", {
      innerHTML: diff
        .split("\n")
        .map((line) => {
          const safe = escapeHtml(line);
          if (line.startsWith("+")) return `<span class="diff-add">${safe}</span>`;
          if (line.startsWith("-")) return `<span class="diff-del">${safe}</span>`;
          if (line.startsWith("@@")) return `<span class="diff-hunk">${safe}</span>`;
          return safe;
        })
        .join("\n"),
    });
    wrap.appendChild(head);
    wrap.appendChild(pre);
    return wrap;
  }

  private metricRow(
    metrics: Array<{ label: string; value: string; good?: boolean }>,
  ): HTMLElement {
    const grid = el("div", { className: "metrics" });
    for (const m of metrics) {
      const tile = el("div", { className: "metric" });
      const v = el("div", { className: `metric-value${m.good ? " good" : ""}`, textContent: m.value });
      const l = el("div", { className: "metric-label", textContent: m.label });
      tile.appendChild(v);
      tile.appendChild(l);
      grid.appendChild(tile);
    }
    return grid;
  }

  private scroll(): void {
    if (!this.autoScroll) return;
    this.container.scrollTop = this.container.scrollHeight;
  }

  // ── Copy / serialise ──────────────────────────────────────────────────
  private async copyToClipboard(text: string, button: HTMLButtonElement): Promise<void> {
    const original = button.textContent ?? "Copy";
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied ✓";
    } catch {
      // Fallback for older browsers / insecure context.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); button.textContent = "Copied ✓"; }
      catch { button.textContent = "Copy failed"; }
      document.body.removeChild(ta);
    }
    setTimeout(() => { button.textContent = original; }, 1500);
  }

  /**
   * Render an entire session (the events accumulated between start() and the
   * session_end event) as markdown suitable for pasting into chat or a doc.
   */
  private serialiseToMarkdown(events: StreamEvent[]): string {
    const out: string[] = [];
    let sessionMeta = "";
    let sessionPrompt = "";

    // First pass — collect session_start metadata so we can put it at the top.
    for (const e of events) {
      if (e.type === "session_start") {
        sessionMeta = `**model** \`${e.model}\` · **cwd** \`${e.sandbox}\``;
        sessionPrompt = e.prompt;
        break;
      }
    }

    out.push(`# piebox session — ${new Date().toLocaleString()}`);
    if (sessionMeta) out.push(sessionMeta);
    if (sessionPrompt) {
      out.push("");
      out.push(`**prompt:** ${sessionPrompt}`);
    }
    out.push("");

    // Group text deltas into a single block (the renderer does this visually).
    let textBuf = "";
    const flushText = () => {
      if (textBuf) {
        out.push("### 🗣 assistant");
        out.push("");
        out.push(textBuf.trim());
        out.push("");
        textBuf = "";
      }
    };

    for (const e of events) {
      if (e.type === "text_delta") {
        textBuf += e.delta;
        continue;
      }
      flushText();

      switch (e.type) {
        case "thinking":
          out.push("### 💭 thinking");
          out.push("");
          out.push(e.text);
          out.push("");
          break;
        case "file_create":
          out.push(`### + create \`${e.path}\``);
          out.push("");
          out.push("```" + (e.language || "text"));
          out.push(e.content);
          out.push("```");
          out.push("");
          break;
        case "file_edit":
          out.push(`### ✎ edit \`${e.path}\``);
          out.push("");
          out.push("```diff");
          out.push(e.diff);
          out.push("```");
          out.push("");
          break;
        case "bash": {
          const result = this.bashOutputByToolCallId.get(e.toolCallId);
          const tag = result?.isError ? "❌ bash (failed)" : "$ bash";
          out.push(`### ${tag}`);
          out.push("");
          out.push("```sh");
          out.push(e.command);
          out.push("```");
          if (result) {
            out.push("");
            out.push("```");
            out.push(result.output || "(no output)");
            out.push("```");
          }
          out.push("");
          break;
        }
        case "file_read":
          out.push(`- 👁 read \`${e.path}\``);
          break;
        case "file_list":
          out.push(`- 📂 ls \`${e.path}\``);
          break;
        case "search":
          out.push(`- 🔎 ${e.tool} \`${e.query}\``);
          break;
        case "session_end":
          out.push("");
          out.push("### ✓ session complete");
          out.push("");
          out.push(`- duration: **${(e.durationMs / 1000).toFixed(2)}s**`);
          out.push(`- tool calls: **${e.toolCalls}**`);
          if (e.newFiles.length) {
            out.push(`- new files (${e.newFiles.length}):`);
            for (const p of e.newFiles) out.push(`  - \`${p}\``);
          }
          if (e.modifiedFiles.length) {
            out.push(`- modified files (${e.modifiedFiles.length}):`);
            for (const p of e.modifiedFiles) out.push(`  - \`${p}\``);
          }
          break;
        case "error":
          out.push(`### ⚠ ${e.code}`);
          out.push("");
          out.push("```");
          out.push((e as any).message ?? "");
          out.push("```");
          out.push("");
          break;
      }
    }
    flushText();

    return out.join("\n");
  }
}
