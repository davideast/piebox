/**
 * Interactive shell session glued to an xterm.js Terminal.
 *
 * Scope (MVP, deliberately small):
 *   - Line buffer: printable chars, backspace, enter.
 *   - History: up/down arrow walks back through past commands.
 *   - Builtins handled in the terminal layer (because each runtime.run
 *     is a fresh process and shell-built state would not persist):
 *       cd <path>   change session cwd
 *       pwd         print session cwd
 *       clear       term.clear()
 *       help        print supported substrate notes
 *   - Ctrl+C: abort the in-flight command, return to prompt.
 *   - Ctrl+L: clear screen, redraw prompt with current buffer.
 *   - Every other command (node, npm, git, etc.) is forwarded to
 *     runInSandbox so the same translators that protect the agent
 *     protect the user.
 *
 * Out of scope: left/right cursor movement within the line, tab
 * completion, ANSI history-incremental-search, true TTY emulation,
 * job control. Programs that want a TTY (vim, top) will not behave
 * naturally — that limitation is in almostnode, not in xterm.
 */

import type { Terminal } from "@xterm/xterm";
import type { PieboxFS, PieboxRuntime } from "piebox/browser";
import { runInSandbox } from "./translators.js";
import { tokenize } from "./git-shim.js";

const HOME = "/work";

export interface ShellDeps {
  fs: PieboxFS;
  runtime: PieboxRuntime;
}

export class ShellSession {
  private cwd = HOME;
  private buffer = "";
  private history: string[] = [];
  private historyIdx = 0; // points one past last entry == "live buffer"
  private busy = false;
  private abortController: AbortController | null = null;
  private disposeListener: { dispose: () => void } | null = null;

  constructor(private term: Terminal, private deps: ShellDeps) {}

  start(): void {
    this.writeBanner();
    this.writePrompt({ leadingNewline: false });
    this.disposeListener = this.term.onData((data) => this.onData(data));
  }

  dispose(): void {
    this.disposeListener?.dispose();
    this.disposeListener = null;
    this.abortController?.abort();
  }

  // ── Output helpers ──────────────────────────────────────────────────────

  private writeBanner(): void {
    this.term.writeln("\x1b[2mpiebox shell — cwd defaults to /work. type 'help' for substrate notes.\x1b[0m");
    this.term.writeln("\x1b[2mShares the /work VFS with the agent. Ctrl+C aborts. Ctrl+L clears.\x1b[0m");
  }

  private writePrompt(opts: { leadingNewline?: boolean } = {}): void {
    // After `clear` (and the initial banner) the cursor is already on
    // a fresh row at column 0; everywhere else we want a CR+LF so the
    // prompt starts on its own line. Callers opt out with
    // `leadingNewline: false`.
    const lead = opts.leadingNewline === false ? "" : "\r\n";
    this.term.write(`${lead}\x1b[36m${this.cwd}\x1b[0m $ ${this.buffer}`);
  }

  /** Programs emit `\n` to end lines; xterm needs `\r\n` to also reset
   *  the column. Replace any LF that isn't already preceded by CR. */
  private normalizeNewlines(s: string): string {
    return s.replace(/(?<!\r)\n/g, "\r\n");
  }

  // ── Input handler ──────────────────────────────────────────────────────

  private onData(data: string): void {
    if (this.busy) {
      // While a command is running, the only keystroke we honor is
      // Ctrl+C. Everything else is dropped — almostnode's runtime
      // does not expose interactive stdin in a way that composes
      // cleanly with xterm's line editor.
      if (data === "\x03") this.abortController?.abort();
      return;
    }

    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      // Escape sequences (arrow keys) come as 3-byte CSI strings.
      if (c === "\x1b" && data[i + 1] === "[") {
        const code = data[i + 2];
        i += 2;
        if (code === "A") this.recallHistory(-1);
        else if (code === "B") this.recallHistory(+1);
        // Left/right arrows: intentionally swallowed in MVP.
        continue;
      }
      if (c === "\r") {
        // Enter
        const cmd = this.buffer;
        this.buffer = "";
        if (cmd.trim()) this.history.push(cmd);
        // Reset history pointer AFTER push so up-arrow recalls the
        // command we just submitted (off-by-one if we set it before).
        this.historyIdx = this.history.length;
        void this.runCommand(cmd);
        return; // runCommand owns the prompt redraw
      }
      if (c === "\x7f" || c === "\x08") {
        // Backspace
        if (this.buffer.length === 0) continue;
        this.buffer = this.buffer.slice(0, -1);
        this.term.write("\b \b");
        continue;
      }
      if (c === "\x03") {
        // Ctrl+C at the prompt: drop the buffer, fresh line.
        this.term.write("^C");
        this.buffer = "";
        this.writePrompt();
        continue;
      }
      if (c === "\x0c") {
        // Ctrl+L: clear and redraw. After term.clear() the cursor is
        // at (0,0) on a fresh viewport so we skip the leading newline.
        this.term.clear();
        this.writePrompt({ leadingNewline: false });
        continue;
      }
      // Printable
      if (c >= " " || c === "\t") {
        this.buffer += c;
        this.term.write(c);
      }
    }
  }

  private recallHistory(delta: number): void {
    const next = this.historyIdx + delta;
    if (next < 0 || next > this.history.length) return;
    // Erase current buffer visually.
    while (this.buffer.length > 0) {
      this.term.write("\b \b");
      this.buffer = this.buffer.slice(0, -1);
    }
    this.historyIdx = next;
    if (next === this.history.length) return; // live buffer (empty)
    const recalled = this.history[next] ?? "";
    this.buffer = recalled;
    this.term.write(recalled);
  }

  // ── Command dispatch ───────────────────────────────────────────────────

  private async runCommand(cmd: string): Promise<void> {
    const trimmed = cmd.trim();
    if (!trimmed) {
      this.writePrompt();
      return;
    }
    if (this.handleBuiltin(trimmed)) return;

    this.busy = true;
    this.abortController = new AbortController();
    this.term.write("\r\n");

    try {
      const result = await runInSandbox(trimmed, {
        fs: this.deps.fs,
        runtime: this.deps.runtime,
        cwd: this.cwd,
        signal: this.abortController.signal,
        onStdout: (chunk) => this.term.write(this.normalizeNewlines(chunk)),
        onStderr: (chunk) =>
          this.term.write("\x1b[31m" + this.normalizeNewlines(chunk) + "\x1b[0m"),
      });
      if (result.exitCode !== 0 && result.exitCode !== 130) {
        this.term.write(`\r\n\x1b[2;31m[exit ${result.exitCode}]\x1b[0m`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.term.write(`\r\n\x1b[31mshell error: ${msg}\x1b[0m`);
    } finally {
      this.busy = false;
      this.abortController = null;
      this.writePrompt();
    }
  }

  /** Returns true when the command was a builtin (we owned the
   *  prompt redraw); false to let runCommand forward to the runtime. */
  private handleBuiltin(cmd: string): boolean {
    const tokens = tokenize(cmd);
    if (tokens.length === 0) return false;
    const verb = tokens[0];

    if (verb === "cd") {
      const target = tokens[1] ?? HOME;
      const next = resolvePath(this.cwd, target);
      try {
        const st = this.deps.fs.statSync(next);
        if (!st.isDirectory()) {
          this.term.write(`\r\n\x1b[31mcd: ${target}: not a directory\x1b[0m`);
        } else {
          this.cwd = next;
        }
      } catch {
        this.term.write(`\r\n\x1b[31mcd: ${target}: no such file or directory\x1b[0m`);
      }
      this.writePrompt();
      return true;
    }

    if (verb === "pwd") {
      this.term.write(`\r\n${this.cwd}`);
      this.writePrompt();
      return true;
    }

    if (verb === "clear") {
      this.term.clear();
      this.writePrompt({ leadingNewline: false });
      return true;
    }

    if (verb === "help") {
      this.term.write(
        "\r\n" +
          [
            "Substrate notes:",
            "  - cwd, pwd, cd, clear, help are handled in the shell.",
            "  - node, npm, ls, cat, mkdir, rm, grep — forwarded to almostnode's just-bash.",
            "  - git init/status/add/commit/log/branch/checkout — routed to isomorphic-git.",
            "  - npm create <name> / npm init <name> — translated to install + run-bin.",
            "  - node -e '<code>' — translated to write+run+delete tempfile.",
            "  - npm install — devDeps backstop applied automatically.",
            "  - Out of reach: curl/wget/python/make/native addons/raw TCP. Dev servers cannot use --host.",
            "  - The /work VFS is shared with the agent's actions.",
          ].join("\r\n"),
      );
      this.writePrompt();
      return true;
    }

    return false;
  }
}

/** Normalize cwd + target into an absolute, dot-resolved path.
 *  Symlinks are not followed (almostnode does not have them). */
export function resolvePath(cwd: string, target: string): string {
  if (!target || target === "~") return HOME;
  const base = target.startsWith("/") ? target : `${cwd.replace(/\/$/, "")}/${target}`;
  const parts = base.split("/").filter((p) => p !== "" && p !== ".");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return "/" + stack.join("/");
}
