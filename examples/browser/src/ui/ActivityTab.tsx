// Right-panel timeline: groups chat messages into per-turn cards. Mirrors
// playground-next's ActivityTab minus the enhancer/suggestion surfaces
// and the drill-in panes (kept the inline Fold-based tool view from
// @pyric/ui/agents instead — simpler, headless, fits the slimmed-down
// scope of the piebox playground).
import { useEffect, useMemo, useRef } from 'react';
import { EmptyState } from '@pyric/ui/agents';
import { useChatStore, type ChatMessage } from '../store/chat.js';
import { Turn } from './Turn.js';

interface TurnGroup {
  prompt: ChatMessage;
  responses: ChatMessage[];
}

function groupByTurn(messages: readonly ChatMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let current: TurnGroup | null = null;
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      current = { prompt: m, responses: [] };
      groups.push(current);
      continue;
    }
    if (m.role === 'assistant' && current) {
      current.responses.push(m);
    }
  }
  return groups;
}

export function ActivityTab() {
  const messages = useChatStore((s) => s.messages);
  const groups = useMemo(() => groupByTurn(messages), [messages]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const lastTextLen = groups[groups.length - 1]?.responses.at(-1)?.text.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [groups.length, lastTextLen]);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<span className="material-symbols-outlined">bolt</span>}
        title="No actions yet"
        body="Type a prompt below to start a conversation. The agent's actions will appear here as they run."
      />
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="flex flex-col gap-4 w-full pt-4 px-4 pb-6">
        {groups.map((g, i) => (
          <Turn
            key={g.prompt.id}
            prompt={g.prompt}
            responses={g.responses}
            isLatest={i === groups.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
