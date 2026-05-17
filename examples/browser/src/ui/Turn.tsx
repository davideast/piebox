// Simplified Turn renderer — one user prompt + N assistant responses.
// Foldable. Tool calls render inline via @pyric/ui/agents Fold; clicking
// a fold shows args/result.
import { useState } from 'react';
import { Fold } from '@pyric/ui/agents';
import { PulsingDot } from '@pyric/ui/agents';
import { Markdown } from './Markdown.js';
import type { ChatMessage, ToolCall } from '../store/chat.js';

interface TurnProps {
  prompt: ChatMessage;
  responses: ChatMessage[];
  isLatest?: boolean;
}

function fmtTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 5);
}

export function Turn({ prompt, responses, isLatest = true }: TurnProps) {
  const [open, setOpen] = useState(true);

  const previewLine = (prompt.text ?? '').split('\n').find((l) => l.trim()) ?? '';

  return (
    <article className="rounded-lg border border-[#2a2a35] bg-content-bg overflow-hidden">
      <header
        className={[
          'flex flex-col gap-1 px-4 pt-3 pb-3 bg-[#1a1a22]/60',
          open ? 'border-b border-[#2a2a35]' : '',
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-soft-white transition-colors group"
            title={open ? 'Collapse this turn' : 'Expand this turn'}
          >
            <span className="text-[11px] font-mono text-slate-gray shrink-0">
              {fmtTime(prompt.createdAt)}
            </span>
            <span
              className="material-symbols-outlined text-[14px] text-slate-gray shrink-0 transition-transform group-hover:text-soft-white"
              style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
              aria-hidden
            >
              chevron_right
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-gray shrink-0">
              you
            </span>
            {!open && previewLine ? (
              <span className="text-[12px] text-slate-gray/70 truncate min-w-0 ml-1">
                {previewLine}
              </span>
            ) : null}
          </button>
        </div>
        {open ? (
          <div className="text-[13px] text-soft-white leading-snug break-words font-display">
            {prompt.text ? (
              <Markdown source={prompt.text} />
            ) : (
              <span className="text-slate-gray italic">(empty prompt)</span>
            )}
          </div>
        ) : null}
      </header>

      {open ? (
        <div className="flex flex-col gap-4 px-4 py-4">
          {responses.length === 0 ? (
            <p className="text-[12px] text-slate-gray italic flex items-center gap-2">
              <PulsingDot />
              waiting for the agent…
            </p>
          ) : (
            responses.map((m) => <AssistantBlock key={m.id} message={m} isLatest={isLatest} />)
          )}
        </div>
      ) : null}
    </article>
  );
}

function AssistantBlock({ message, isLatest }: { message: ChatMessage; isLatest: boolean }) {
  const calls = message.toolCalls ?? [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-gray">
          agent
        </span>
        <span className="text-[11px] font-mono text-slate-gray">
          {fmtTime(message.createdAt)}
        </span>
        {isLatest && message.text.length === 0 && calls.length === 0 ? <PulsingDot /> : null}
      </div>

      {message.text ? (
        <div className="text-[13px] text-soft-white leading-snug break-words font-display">
          <Markdown source={message.text} />
        </div>
      ) : null}

      {calls.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {calls.map((c) => (
            <ToolCallRow key={c.id} call={c} />
          ))}
        </div>
      ) : null}

      {message.metrics ? (
        <div className="text-[10px] font-mono text-slate-gray/60 mt-1">
          {message.metrics.tokensIn}in · {message.metrics.tokensOut}out
        </div>
      ) : null}
    </div>
  );
}

function ToolCallRow({ call }: { call: ToolCall }) {
  const statusTone =
    call.status === 'failed' ? 'error' : call.status === 'pending' ? 'thought' : 'normal';
  const header = (
    <span className="inline-flex items-center gap-2 text-[12px]">
      <span className="font-mono text-soft-white">{call.name}</span>
      <span className="text-slate-gray text-[11px] truncate max-w-[40ch]">{summarize(call)}</span>
      <span
        className={[
          'text-[9px] uppercase tracking-wider',
          call.status === 'failed'
            ? 'text-[#f0a0a0]'
            : call.status === 'pending'
              ? 'text-slate-gray'
              : 'text-[#a4d4a8]',
        ].join(' ')}
      >
        {call.status === 'pending' ? '…' : call.status}
      </span>
    </span>
  );
  return (
    <Fold tone={statusTone as 'normal' | 'error' | 'thought'} header={header}>
      <div className="space-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-gray mb-1">args</p>
          <pre className="text-[11px] font-mono text-slate-gray/90 whitespace-pre-wrap break-words bg-[#0e0e12] rounded p-2">
            {JSON.stringify(call.args, null, 2)}
          </pre>
        </div>
        {call.summary ? (
          <p className="text-[12px] text-soft-white">{call.summary}</p>
        ) : null}
        {call.result ? (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-gray mb-1">result</p>
            <pre className="text-[11px] font-mono text-slate-gray/90 whitespace-pre-wrap break-words bg-[#0e0e12] rounded p-2 max-h-[240px] overflow-auto custom-scrollbar">
              {previewResult(call.result)}
            </pre>
          </div>
        ) : null}
      </div>
    </Fold>
  );
}

function summarize(call: ToolCall): string {
  const a = (call.args ?? {}) as Record<string, unknown>;
  if (call.name === 'bash') return String(a.command ?? '');
  if ('path' in a) return String(a.path ?? '');
  return JSON.stringify(a).slice(0, 80);
}

function previewResult(r: unknown): string {
  if (typeof r === 'string') return r;
  try {
    return JSON.stringify(r, null, 2);
  } catch {
    return String(r);
  }
}
