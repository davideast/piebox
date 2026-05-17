// Mobile bottom-tab selection. Mirrors playground-next, minus the
// Firebase-specific `app` tab. Just Workspace (Preview) and Agent here.
import { create } from 'zustand';

export type MobileTab = 'workspace' | 'agent';

interface MobileNavState {
  activeTab: MobileTab;
  workspaceUnread: boolean;
  agentUnread: boolean;
  setActive(tab: MobileTab): void;
  markUnread(tab: MobileTab): void;
}

export const useMobileNavStore = create<MobileNavState>((set) => ({
  activeTab: 'agent',
  workspaceUnread: false,
  agentUnread: false,
  setActive(tab) {
    set((s) =>
      tab === 'workspace'
        ? { activeTab: tab, workspaceUnread: false, agentUnread: s.agentUnread }
        : { activeTab: tab, workspaceUnread: s.workspaceUnread, agentUnread: false },
    );
  },
  markUnread(tab) {
    set((s) =>
      tab === 'workspace'
        ? { ...s, workspaceUnread: s.activeTab !== 'workspace' }
        : { ...s, agentUnread: s.activeTab !== 'agent' },
    );
  },
}));
