// Ported from playground-next, enhancer toggle removed (no enhancer in
// piebox). Same Send / Stop interaction model, plus a `phase` prop so
// the Stop button only shows while the LLM is producing tokens. During
// tool execution (long-lived `bash` commands like `next start`) we show
// a quieter "running…" pill — Stop is for LLM interactions only.
import { useRef } from 'react';
import type { SessionPhase } from '../store/session.js';

interface ComposeBarProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  sending?: boolean;
  phase?: SessionPhase;
  disabled?: boolean;
  placeholder?: string;
}

export function ComposeBar({
  value,
  onChange,
  onSubmit,
  onStop,
  sending = false,
  phase = 'idle',
  disabled = false,
  placeholder = 'Ask the agent…',
}: ComposeBarProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const canSubmit = !disabled && !sending && value.trim().length > 0;
  const showStop = sending && phase === 'llm';
  const showToolBusy = sending && phase === 'tool';

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="shrink-0 border-t border-[#2a2a35] bg-sidebar-bg p-3 grid gap-2">
      <textarea
        ref={taRef}
        className="w-full bg-content-bg border border-[#2a2a35] rounded-md px-3 py-2.5 text-[13px] text-soft-white placeholder:text-slate-gray/60 focus:outline-none focus:border-slate-gray transition-colors font-display resize-none min-h-[64px] max-h-[200px]"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        rows={3}
        spellCheck={false}
        disabled={disabled || sending}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-slate-gray">⌘ / Ctrl + Enter to send</span>
        {showStop && onStop ? (
          <button
            type="button"
            onClick={onStop}
            data-testid="stop-button"
            className="px-3 py-1.5 rounded-full border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors text-[12px] font-semibold"
          >
            Stop
          </button>
        ) : showToolBusy ? (
          // Tool is running (probably a long-lived bash like a dev
          // server). Stop is hidden because it would kill the tool —
          // and the user told us Stop is for LLM interactions only.
          // Show a non-interactive busy pill instead.
          <span
            data-testid="tool-busy"
            className="px-3 py-1.5 rounded-full border border-[#2a2a35] text-slate-gray text-[12px] font-semibold inline-flex items-center gap-2 cursor-default select-none"
            title="A tool is running. The LLM is waiting on it. Use the top-right edit_square button to start a new chat if you need to abort."
          >
            <span className="w-1.5 h-1.5 rounded-full bg-slate-gray animate-pulse" aria-hidden />
            <span>Running tool…</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className={[
              'px-4 py-1.5 rounded-full text-[12px] font-semibold transition-colors inline-flex items-center gap-1.5',
              canSubmit
                ? 'bg-soft-white text-content-bg hover:bg-white'
                : 'bg-soft-white/20 text-soft-white/40 cursor-not-allowed',
            ].join(' ')}
          >
            <span>Send</span>
          </button>
        )}
      </div>
    </div>
  );
}
