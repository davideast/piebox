/**
 * @piebox/driver-cli — driver spike
 *
 * Exposes a piebox Sandbox via a line-buffered terminal interface.
 * The driver is transport-agnostic: the consumer supplies a small
 * `CliTerminal` adapter (xterm.js, ink, raw stdio, whatever) and the
 * driver runs the line editor, history, builtins, and tool dispatch
 * on top.
 *
 * Branches on (per E Table 2): fileSystem, processModel, interactiveTty.
 *
 * NOT informed by anything beyond ./layer2.d.ts.
 */

import type {
  PieboxResult,
  PieboxTool,
  PieboxToolset,
  Sandbox,
} from "./layer2.d.ts";

// ─────────────────────────────────────────────────────────────────────
// Terminal adapter — consumer-supplied
// ─────────────────────────────────────────────────────────────────────

export interface CliTerminal {
  write(text: string): void;
  clear(): void;
  onData(callback: (data: string) => void): { dispose(): void };
}

export interface CliDriver {
  start(): void;
  stop(): void;
}

export interface CreateCliDriverOptions {
  sandbox: Sandbox;
  toolset: PieboxToolset;
  terminal: CliTerminal;
}

// ─────────────────────────────────────────────────────────────────────
// Driver
// ─────────────────────────────────────────────────────────────────────

export function createCliDriver(opts: CreateCliDriverOptions): CliDriver {
  const { sandbox, toolset, terminal } = opts;
  const caps = sandbox.runtime.capabilities;
  const cwdColor = caps.fileSystem === "vfs" ? "\x1b[36m" : "\x1b[32m"; // cyan vfs / green os
  const RESET = "\x1b[0m";
  const RED = "\x1b[31m";

  // Tools keyed by name for first-token dispatch.
  const byName = new Map<string, PieboxTool>();
  for (const t of toolset.tools) byName.set(t.name, t);
  const bash = byName.get("bash"); // canonical fallback

  let cwd = sandbox.cwd;
  let buffer = "";
  const history: string[] = [];
  let historyIdx = 0;
  let busy = false;
  let abort: AbortController | null = null;
  let sub: { dispose(): void } | null = null;

  const prompt = (lead = "\r\n") =>
    terminal.write(`${lead}${cwdColor}${cwd}${RESET} $ ${buffer}`);

  const banner = () => {
    const proc = caps.processModel === "shim" ? "almostnode in-browser" : "host shell";
    terminal.write(`piebox cli — processModel: ${proc}\r\n`);
  };

  const help = () => {
    const tty = caps.interactiveTty;
    terminal.write("\r\n" + [
      "Builtins: cd <path>, pwd, clear, help",
      `Tools: ${[...byName.keys()].join(", ") || "(none)"}`,
      `Unknown commands forward to: ${bash ? "bash" : "(no bash tool — falls through)"}`,
      `fileSystem=${caps.fileSystem}  processModel=${caps.processModel}  interactiveTty=${tty}`,
      tty ? "TTY-shaped programs supported." : "raw mode programs (vim, top, REPLs) will not work in this substrate.",
      "Ctrl+C aborts the running command. Ctrl+L clears the screen.",
    ].join("\r\n"));
  };

  // ── Line editor ───────────────────────────────────────────────────
  const recall = (delta: number) => {
    const next = historyIdx + delta;
    if (next < 0 || next > history.length) return;
    while (buffer.length > 0) { terminal.write("\b \b"); buffer = buffer.slice(0, -1); }
    historyIdx = next;
    if (next === history.length) return;
    buffer = history[next] ?? "";
    terminal.write(buffer);
  };

  const onData = (data: string) => {
    if (busy) { if (data === "\x03") abort?.abort(); return; }
    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      if (c === "\x1b" && data[i + 1] === "[") {
        const code = data[i + 2]; i += 2;
        if (code === "A") recall(-1); else if (code === "B") recall(+1);
        continue;
      }
      if (c === "\r") {
        const cmd = buffer; buffer = "";
        if (cmd.trim()) history.push(cmd);
        historyIdx = history.length;
        void run(cmd);
        return;
      }
      if (c === "\x7f" || c === "\x08") {
        if (buffer.length === 0) continue;
        buffer = buffer.slice(0, -1); terminal.write("\b \b"); continue;
      }
      if (c === "\x03") { terminal.write("^C"); buffer = ""; prompt(); continue; }
      if (c === "\x0c") { terminal.clear(); prompt(""); continue; }
      if (c >= " " || c === "\t") { buffer += c; terminal.write(c); }
    }
  };

  // ── Dispatch ──────────────────────────────────────────────────────
  const builtin = (cmd: string): boolean => {
    const [verb, ...rest] = cmd.trim().split(/\s+/);
    if (verb === "cd") {
      const target = rest[0] ?? "/";
      const next = target.startsWith("/") ? target : `${cwd.replace(/\/$/, "")}/${target}`;
      try {
        const st = sandbox.fs.statSync(next);
        if (!st.isDirectory()) terminal.write(`\r\n${RED}cd: ${target}: not a directory${RESET}`);
        else cwd = next;
      } catch { terminal.write(`\r\n${RED}cd: ${target}: no such file or directory${RESET}`); }
      prompt(); return true;
    }
    if (verb === "pwd") { terminal.write(`\r\n${cwd}`); prompt(); return true; }
    if (verb === "clear") { terminal.clear(); prompt(""); return true; }
    if (verb === "help") { help(); prompt(); return true; }
    return false;
  };

  const run = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) { prompt(); return; }
    if (builtin(trimmed)) return;

    busy = true; abort = new AbortController(); terminal.write("\r\n");
    const verb = trimmed.split(/\s+/)[0]!;
    const tool = byName.get(verb) ?? bash;
    if (!tool) {
      terminal.write(`${RED}no tool for '${verb}' and no bash fallback${RESET}`);
      busy = false; abort = null; prompt(); return;
    }
    // The verb-matched tool receives a structured arg; the bash fallback
    // gets the raw command. Both shapes are inferred from the tool's name
    // since the spike has no per-tool argv parser. TODO below.
    const args: unknown = tool === bash && tool.name === "bash"
      ? { command: trimmed, cwd }
      : { _raw: trimmed.slice(verb.length).trim(), cwd };

    const onChunk = (text: string, stream: "stdout" | "stderr") => {
      const norm = text.replace(/(?<!\r)\n/g, "\r\n");
      terminal.write(stream === "stderr" ? `${RED}${norm}${RESET}` : norm);
    };
    try {
      let result: PieboxResult;
      if (tool.executeStreaming) {
        result = await tool.executeStreaming(args, sandbox, abort.signal, onChunk);
      } else {
        result = await tool.execute(args, sandbox, abort.signal);
        if (result.summary) onChunk(result.summary, result.ok ? "stdout" : "stderr");
      }
      if (!result.ok) terminal.write(`\r\n\x1b[2;31m[failed]${RESET}`);
    } catch (e) {
      terminal.write(`\r\n${RED}cli error: ${e instanceof Error ? e.message : String(e)}${RESET}`);
    } finally {
      busy = false; abort = null; prompt();
    }
  };

  return {
    start() { banner(); prompt(""); sub = terminal.onData(onData); },
    stop() { sub?.dispose(); sub = null; abort?.abort(); },
  };
}

/*
## Layer 2 gaps surfaced by this spike

1. **No way to enumerate tool argv shapes.** A CLI driver inherently
   parses `verb arg1 arg2 --flag` strings into structured args, but
   `PieboxTool.inputSchema` only declares a JSON Schema object — it
   does not say "this property maps to positional argv[0]" or
   "--cwd → property cwd". The spike falls back to a kludge: bash gets
   `{ command, cwd }`, every other verb gets `{ _raw, cwd }`. A real
   CLI driver needs either (a) a per-tool argv adapter on `PieboxTool`,
   or (b) a piebox-supplied `argvToArgs(schema, argv)` helper.

2. **No way to enumerate tools-by-name.** `PieboxToolset` is just
   `readonly tools: readonly PieboxTool[]`. The spike builds its own
   `Map<string, PieboxTool>`. Cheap, but every driver will do it. A
   `toolset.get(name)` would belong on the type.

3. **No way to ask the sandbox for its *current* cwd after a `cd`.**
   The spike tracks `cwd` locally because `sandbox.cwd` is `readonly`
   and there is no `sandbox.chdir`. This is fine for a single-driver
   sandbox, but if a tool itself changes directory (e.g. a future
   `chdir` tool) the driver's mirror goes stale. Either model `cwd`
   as mutable on the sandbox, or document that drivers must own it.

4. **No way to know whether a tool's output is "complete" without
   awaiting `execute`.** Fine for batch tools but the CLI wants to
   show the prompt the instant a streaming tool drains. Currently
   `executeStreaming` resolves only when finished, which is what we
   want — but there's no signal for "the user can type the next
   command while output keeps streaming". For now we serialize.

5. **No structured exit code.** `PieboxResult.ok` is a boolean. The
   shell-session original printed `[exit ${result.exitCode}]` from
   `PieboxRunResult`. A CLI driver loses fidelity going through the
   tool descriptor. Consider `PieboxResult.exitCode?: number`.

6. **`interactiveTty` is consumed only in the help text here.** No
   tool can ask the driver "are you a TTY?" — which means a future
   raw-mode tool (e.g. `repl`) cannot opt out gracefully when run
   under a non-TTY transport. Not a Layer 2 gap per se, but a sign
   that `interactiveTty` may need to flow into tool inputs, not just
   sit on capabilities for the driver to template.
*/
