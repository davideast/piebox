// Ported from playground-next, enhancer toggle removed (no enhancer in
// piebox). Same Send / Stop interaction model.
import { useRef } from 'react';

interface ComposeBarProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function ComposeBar({
  value,
  onChange,
  onSubmit,
  onStop,
  sending = false,
  disabled = false,
  placeholder = 'Ask the agent…',
}: ComposeBarProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const canSubmit = !disabled && !sending && value.trim().length > 0;

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
        {sending && onStop ? (
          <button
            type="button"
            onClick={onStop}
            className="px-3 py-1.5 rounded-full border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors text-[12px] font-semibold"
          >
            Stop
          </button>
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
