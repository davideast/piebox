// Ported from playground-next.
interface StatusBarProps {
  modelLabel?: string | null;
  sessionState: 'idle' | 'streaming' | 'failed';
  error?: string | null;
  turns?: number;
  tokensTotal?: number;
}

export function StatusBar({
  modelLabel,
  sessionState,
  error,
  turns = 0,
  tokensTotal = 0,
}: StatusBarProps) {
  return (
    <footer className="h-[28px] bg-sidebar-bg border-t border-[#2a2a32] shrink-0 flex items-center justify-between px-3 relative">
      {error ? (
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[14px] text-red-500 shrink-0">
            error
          </span>
          <span className="text-[11px] text-red-400 truncate">{error}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 min-w-0">
          {modelLabel ? (
            <span className="text-[11px] font-mono text-slate-gray truncate">
              {modelLabel}
            </span>
          ) : null}
          {sessionState === 'failed' ? (
            <>
              <span className="hidden sm:inline text-[11px] text-slate-gray shrink-0">·</span>
              <span className="text-[11px] text-red-400 shrink-0">failed</span>
            </>
          ) : null}
        </div>
      )}

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <span className="text-[11px] font-mono text-slate-gray">
          {turns}t
          <span className="hidden sm:inline">{turns === 1 ? ' turn' : ' turns'}</span>
        </span>
        <span className="text-[11px] text-slate-gray">·</span>
        <span className="text-[11px] font-mono text-slate-gray">
          {tokensTotal.toLocaleString()} tok
        </span>
      </div>
    </footer>
  );
}
