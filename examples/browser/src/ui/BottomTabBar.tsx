// Ported from playground-next, slimmed: two tabs (Workspace · Agent).
// piebox has no separate mobile "App" tab — Preview lives inside
// Workspace on every breakpoint.
import { useMobileNavStore, type MobileTab } from '../store/mobile-nav.js';

interface TabDef {
  id: MobileTab;
  icon: string;
  label: string;
}

const TABS: readonly TabDef[] = [
  { id: 'workspace', icon: 'code', label: 'Workspace' },
  { id: 'agent', icon: 'chat', label: 'Agent' },
];

export function BottomTabBar() {
  const activeTab = useMobileNavStore((s) => s.activeTab);
  const workspaceUnread = useMobileNavStore((s) => s.workspaceUnread);
  const agentUnread = useMobileNavStore((s) => s.agentUnread);
  const setActive = useMobileNavStore((s) => s.setActive);

  return (
    <nav
      className="md:hidden bg-sidebar-bg border-t border-[#2a2a35] flex shrink-0 z-30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        const unread = tab.id === 'workspace' ? workspaceUnread : agentUnread;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={[
              'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors',
              active ? 'text-soft-white' : 'text-slate-gray hover:text-soft-white/80',
            ].join(' ')}
          >
            <span className="relative">
              <span className="material-symbols-outlined text-[22px]">{tab.icon}</span>
              {unread && !active ? (
                <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[#a4d4a8] border border-sidebar-bg" />
              ) : null}
            </span>
            <span className="text-[10px] font-medium tracking-wide">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
