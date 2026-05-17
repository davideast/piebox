// REPLACEMENT for playground-next's OutputTab. Read-only terminal —
// streams every line the agent / runtime / container console produces.
//
// Vocabulary follows playground-next's TerminalView:
//   - pure-black background, monospace, tight leading
//   - severity column (info / warn / error), color-coded
//   - optional tag prefix (e.g. [bash], [thinking])
//   - empty state reads as silence (`(no output)`) like a real terminal
//
// "Read-only" means: no input, no commands. The user runs commands via
// the agent loop's tool calls, never directly here. Clear button truncates
// the buffer to keep things responsive across long sessions.
import { useEffect, useRef } from 'react';
import { useTerminalStore, type TerminalLine } from '../store/terminal.js';

function severityTone(level: TerminalLine['level']): string {
  if (level === 'error') return 'text-[#f0a0a0]';
  if (level === 'warn') return 'text-[#e6c79c]';
  return 'text-soft-white/85';
}

export function TerminalTab() {
  const lines = useTerminalStore((s) => s.lines);
  const clear = useTerminalStore((s) => s.clear);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-tail. Pinned to the bottom on every new line; if the user has
  // scrolled up to read history, we leave them alone (detected by
  // checking scrollTop+clientHeight vs scrollHeight before the new line).
  const tailRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (tailRef.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 24;
    tailRef.current = atBottom;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-black">
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-[#1a1a22] bg-[#0a0a0e] shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-gray/80">
          logs · read-only
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-slate-gray/70">
            {lines.length} {lines.length === 1 ? 'line' : 'lines'}
          </span>
          <button
            type="button"
            onClick={() => clear()}
            className="text-[10px] font-mono text-slate-gray hover:text-soft-white transition-colors"
          >
            clear
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto custom-scrollbar"
      >
        {lines.length === 0 ? (
          <div className="px-3 py-4 font-mono text-[12px] text-slate-gray/60 italic">
            (no output)
          </div>
        ) : (
          <ul className="font-mono text-[12px] leading-[1.55] py-2">
            {lines.map((line) => (
              <li key={line.id} className="px-3 py-0.5 whitespace-pre-wrap break-words">
                <div className="flex items-baseline gap-2">
                  <span
                    className={[
                      'w-[60px] shrink-0 uppercase tracking-wider text-[10px]',
                      severityTone(line.level),
                    ].join(' ')}
                  >
                    {line.level}
                  </span>
                  <span className="flex-1 min-w-0">
                    {line.tag ? (
                      <span className="text-slate-gray/60 mr-2">[{line.tag}]</span>
                    ) : null}
                    <span className={severityTone(line.level)}>{line.text}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
