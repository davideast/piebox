// Left-panel workspace. playground-next has Preview / Rules / Code; here
// piebox has just Preview (Firestore rules + the dual code editors are
// firebase-agent-sdk-specific). Reserved as a tabbed shell so future
// surfaces (Files explorer, package.json viewer) drop in without churn.
import { useState } from 'react';
import { EditorPane } from './EditorPane.js';
import { PanelTabs, type Tab } from './PanelTabs.js';
import { PreviewPane } from './PreviewPane.js';

// Editor (file tree + content viewer) leads — it's where the agent's
// effects on the VFS are first visible. Preview follows for the running
// app once a dev server boots. Both render inside this single
// workspace panel; the Editor's internal two-column layout is local to
// that tab, not a top-level pane.
const TABS: readonly Tab[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'preview', label: 'Preview' },
];

export function WorkspacePanel() {
  const [active, setActive] = useState<string>('editor');
  return (
    <div className="flex flex-col h-full bg-content-bg min-w-0">
      <PanelTabs tabs={TABS} activeTab={active} onTabChange={setActive} />
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
        {active === 'editor' ? <EditorPane /> : null}
        {active === 'preview' ? <PreviewPane /> : null}
      </div>
    </div>
  );
}
