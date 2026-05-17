// Dump the current chat + terminal state as a markdown report. Useful
// for opening a bug — paste the result into a doc/issue and it carries
// the exact prompts, tool calls, results, and terminal output.
//
// Format (one block per turn, fenced code for prompts and outputs):
//
//   # piebox playground session — 02:51 (gemini-3-flash-preview · 4 turns · 12,345 tok)
//
//   ## Turn 1 — 02:50
//   ### You
//   <prompt>
//
//   ### Agent (1234in · 567out)
//   <markdown text>
//
//   #### tool: bash · ok
//   args: { "command": "ls" }
//   summary: exit=0
//   ```
//   stdout/stderr/result preview
//   ```
//
//   ---
//   ## Terminal (last 200 lines)
//   ```
//   info [tag] line
//   error [tag] line
//   ```
import type { ChatMessage, ToolCall } from '../store/chat.js';
import type { TerminalLine } from '../store/terminal.js';

interface BuildOpts {
  modelLabel: string;
  turns: number;
  tokensTotal: number;
  messages: readonly ChatMessage[];
  terminal: readonly TerminalLine[];
  /** Cap terminal output so a long session doesn't produce a megabyte
   *  paste. Tail bias — recent lines matter most. */
  terminalLimit?: number;
}

function fmtTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 5);
}

function fence(content: string, lang = ''): string {
  return `\`\`\`${lang}\n${content}\n\`\`\``;
}

function previewResult(r: unknown): string {
  if (typeof r === 'string') return r.slice(0, 4000);
  try {
    return JSON.stringify(r, null, 2).slice(0, 4000);
  } catch {
    return String(r).slice(0, 4000);
  }
}

function renderToolCall(c: ToolCall): string {
  const lines: string[] = [];
  lines.push(`#### tool: \`${c.name}\` · ${c.status}`);
  lines.push('args:');
  lines.push(fence(JSON.stringify(c.args, null, 2), 'json'));
  if (c.summary) lines.push(`summary: \`${c.summary}\``);
  if (c.result !== undefined && c.result !== null) {
    lines.push('result:');
    lines.push(fence(previewResult(c.result)));
  }
  return lines.join('\n');
}

export function buildSessionMarkdown(opts: BuildOpts): string {
  const { modelLabel, turns, tokensTotal, messages, terminal, terminalLimit = 200 } = opts;

  const out: string[] = [];
  const sessionTime = fmtTime(Date.now());
  out.push(
    `# piebox playground session — ${sessionTime} (${modelLabel} · ${turns} turn${turns === 1 ? '' : 's'} · ${tokensTotal.toLocaleString()} tok)`,
  );
  out.push('');

  // Group into turns: each user msg starts one, assistant msgs accumulate.
  let currentPrompt: ChatMessage | null = null;
  let currentResponses: ChatMessage[] = [];
  const turnsList: { prompt: ChatMessage; responses: ChatMessage[] }[] = [];
  const flush = () => {
    if (currentPrompt) {
      turnsList.push({ prompt: currentPrompt, responses: currentResponses });
      currentPrompt = null;
      currentResponses = [];
    }
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      flush();
      currentPrompt = m;
    } else if (m.role === 'assistant' && currentPrompt) {
      currentResponses.push(m);
    }
  }
  flush();

  for (let i = 0; i < turnsList.length; i++) {
    const turn = turnsList[i]!;
    out.push(`## Turn ${i + 1} — ${fmtTime(turn.prompt.createdAt)}`);
    out.push('### You');
    out.push(turn.prompt.text || '(empty prompt)');
    out.push('');
    for (const r of turn.responses) {
      const metricLabel = r.metrics
        ? ` (${r.metrics.tokensIn}in · ${r.metrics.tokensOut}out)`
        : '';
      out.push(`### Agent — ${fmtTime(r.createdAt)}${metricLabel}`);
      if (r.text.trim()) out.push(r.text);
      if (r.toolCalls?.length) {
        out.push('');
        for (const c of r.toolCalls) {
          out.push(renderToolCall(c));
          out.push('');
        }
      }
      out.push('');
    }
    out.push('---');
    out.push('');
  }

  if (terminal.length > 0) {
    const shown = terminal.slice(-terminalLimit);
    out.push(
      `## Terminal (${shown.length === terminal.length ? terminal.length : `last ${shown.length} of ${terminal.length}`} lines)`,
    );
    const body = shown
      .map((l) => {
        const tag = l.tag ? ` [${l.tag}]` : '';
        return `${l.level.toUpperCase().padEnd(5)}${tag} ${l.text}`;
      })
      .join('\n');
    out.push(fence(body));
    out.push('');
  }

  return out.join('\n');
}

/** Best-effort clipboard write. Returns true on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
