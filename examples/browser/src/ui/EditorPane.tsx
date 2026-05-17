// Workspace > Editor tab. Two-column layout INSIDE the workspace panel
// (no extra top-level pane): file tree on the left, file content on the
// right. Mirrors the visual language of the rest of the playground
// (sidebar-bg chrome, slate-gray idle / soft-white active, monospace
// content) but does not pull in CodeMirror — `<pre>` is enough for v1.
//
// The tree is a synchronous recursive walk over PieboxFS rooted at /work.
// `node_modules` and `.git` are pruned by default because npm install
// puts thousands of files into the VFS and renders the tree unusable;
// a "show node_modules" toggle is provided for when the user actually
// needs to inspect them.
//
// Auto-refresh: each completed tool call in the chat store bumps the
// `revision` derived from `messages.length + totalToolCalls`. That gives
// us a cheap heartbeat so the tree reflects writes/edits/deletes without
// asking the agent to emit fs events. A manual refresh button is also
// present for cases the heartbeat misses (e.g. files mutated outside the
// agent loop).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@pyric/ui/agents';
import { getRuntime } from '../store/runtime.js';
import { useChatStore } from '../store/chat.js';
import { useVfsRevisionStore } from '../store/vfs-revision.js';

const ROOT = '/work';
const IGNORE_DEFAULT = new Set(['node_modules', '.git']);
const TREE_OPEN_STORAGE_KEY = 'piebox:editor-tree-open';
const TREE_WIDTH_STORAGE_KEY = 'piebox:editor-tree-width';
const TREE_WIDTH_DEFAULT = 220;
const TREE_WIDTH_MIN = 140;
const TREE_WIDTH_MAX = 480;

function readStoredTreeOpen(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(TREE_OPEN_STORAGE_KEY);
  // Default to visible — explicit `'0'` is the only thing that hides.
  return raw !== '0';
}

function readStoredTreeWidth(): number {
  if (typeof window === 'undefined') return TREE_WIDTH_DEFAULT;
  const v = Number(window.localStorage.getItem(TREE_WIDTH_STORAGE_KEY));
  return Number.isFinite(v) && v >= TREE_WIDTH_MIN && v <= TREE_WIDTH_MAX
    ? v
    : TREE_WIDTH_DEFAULT;
}

interface FileNode {
  kind: 'file';
  name: string;
  path: string;
}
interface DirNode {
  kind: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}
type TreeNode = FileNode | DirNode;

function walk(
  fs: ReturnType<typeof getRuntime>['fs'],
  dir: string,
  showHidden: boolean,
): TreeNode[] {
  let entries: { name: string; isDirectory(): boolean }[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }) as unknown as {
      name: string;
      isDirectory(): boolean;
    }[];
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  for (const ent of entries) {
    if (!showHidden && IGNORE_DEFAULT.has(ent.name)) continue;
    const fullPath = dir === '/' ? `/${ent.name}` : `${dir}/${ent.name}`;
    if (ent.isDirectory()) {
      nodes.push({
        kind: 'dir',
        name: ent.name,
        path: fullPath,
        children: walk(fs, fullPath, showHidden),
      });
    } else {
      nodes.push({ kind: 'file', name: ent.name, path: fullPath });
    }
  }
  // Dirs first, then alphabetical — matches typical IDE trees.
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export function EditorPane() {
  // Trigger lazy boot so /work exists and tool writes show up. Safe to
  // call repeatedly — runtime is memoized.
  useEffect(() => {
    getRuntime();
  }, []);

  // Heartbeat: any new message or completed tool call in the chat store
  // bumps revision, which re-walks the VFS. The interactive Shell tab
  // also bumps `useVfsRevisionStore` after every command it runs, so
  // user-typed mkdirs / installs / git operations show up without a
  // click on the refresh button. Cheap because the FS is in-memory.
  const messageCount = useChatStore((s) => s.messages.length);
  const toolCallCount = useChatStore((s) =>
    s.messages.reduce((sum, m) => sum + (m.toolCalls?.length ?? 0), 0),
  );
  const shellRevision = useVfsRevisionStore((s) => s.revision);
  const [manualTick, setManualTick] = useState(0);
  const revision = messageCount + toolCallCount + shellRevision + manualTick;

  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Tree visibility — persisted so the user's preference survives reload.
  // Toggled from a button in the tree header (collapse) and from a button
  // in the file viewer / empty state (expand).
  const [treeOpen, setTreeOpen] = useState<boolean>(readStoredTreeOpen);
  useEffect(() => {
    try {
      window.localStorage.setItem(TREE_OPEN_STORAGE_KEY, treeOpen ? '1' : '0');
    } catch {
      /* localStorage unavailable */
    }
  }, [treeOpen]);

  // Tree width — drag handle on the right edge of the tree mutates this.
  // Persisted across reloads; clamped to a sensible range so neither the
  // tree nor the viewer can be dragged out of existence. Anchored to the
  // EditorPane root so deeply-nested layout changes (TopBar height,
  // sidebar drag in the parent split) don't shift the conversion math.
  const [treeWidth, setTreeWidth] = useState<number>(readStoredTreeWidth);
  const [isResizing, setIsResizing] = useState(false);
  const draggingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    try {
      window.localStorage.setItem(TREE_WIDTH_STORAGE_KEY, String(treeWidth));
    } catch {
      /* localStorage unavailable */
    }
  }, [treeWidth]);

  const onResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (clientX: number) => {
      if (!draggingRef.current) return;
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = Math.max(
        TREE_WIDTH_MIN,
        Math.min(TREE_WIDTH_MAX, clientX - rect.left),
      );
      setTreeWidth(next);
    };
    const onMouseMove = (ev: MouseEvent) => move(ev.clientX);
    const onTouchMove = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (t) move(t.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }, []);

  const tree = useMemo<TreeNode[]>(() => {
    const { fs } = getRuntime();
    // Make sure /work exists before walking — first render can predate
    // the agent's first write.
    try {
      fs.mkdirSync(ROOT, { recursive: true });
    } catch {
      /* already there */
    }
    return walk(fs, ROOT, showHidden);
    // revision is intentionally a dep so the tree re-walks on heartbeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, showHidden]);

  return (
    <div ref={rootRef} className="flex-1 min-h-0 flex bg-content-bg relative">
      {/* Left column: file tree. Width is user-resizable via the drag
          handle on its right edge (see `<div role="separator">` below)
          and clamped to [MIN, MAX] so neither the tree nor the viewer
          can vanish. Border on the right separates the tree from the
          content viewer inside the SAME workspace panel (not a third
          top-level pane). When collapsed (`treeOpen=false`) the width
          animates to 0 and the drag handle is unmounted. */}
      <aside
        className={[
          'shrink-0 border-r border-[#2a2a35] bg-sidebar-bg flex flex-col min-h-0',
          treeOpen ? '' : 'w-0 overflow-hidden border-r-0',
          // While resizing we want pixel-perfect tracking; the
          // width transition would lag behind the cursor. The
          // class only activates on programmatic toggles
          // (open/close), not on drag.
          treeOpen && !isResizing ? 'transition-[width] duration-150' : '',
        ].join(' ')}
        style={treeOpen ? { width: `${treeWidth}px` } : undefined}
        aria-hidden={!treeOpen}
      >
        <div className="flex items-center justify-between px-2 py-1 border-b border-[#2a2a35] shrink-0">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-gray/80 px-1">
            files · /work
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setManualTick((n) => n + 1)}
              title="Refresh tree"
              className="text-slate-gray hover:text-soft-white transition-colors p-0.5"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
            </button>
            <button
              type="button"
              onClick={() => setTreeOpen(false)}
              title="Hide file tree"
              className="text-slate-gray hover:text-soft-white transition-colors p-0.5"
            >
              <span className="material-symbols-outlined text-[14px]">
                left_panel_close
              </span>
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar py-1">
          {tree.length === 0 ? (
            <p className="text-[11px] text-slate-gray/70 italic px-3 py-2">
              empty — no files yet
            </p>
          ) : (
            <ul className="text-[12px] font-mono">
              {tree.map((node) => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  selected={selected}
                  onSelect={setSelected}
                />
              ))}
            </ul>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-slate-gray px-2 py-1 border-t border-[#2a2a35] shrink-0 cursor-pointer hover:text-soft-white transition-colors">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="accent-soft-white"
          />
          <span>show node_modules / .git</span>
        </label>
      </aside>

      {/* Drag handle between the file tree and the viewer. Same pattern
          as the parent workspace/agent split in PlaygroundPage: a wide
          invisible hit area (`w-3 -mx-1.5`) wrapping a 1px hairline
          that tints on hover. Only mounted when the tree is visible
          — collapsing the tree also removes the handle so dragging
          into an empty column isn't possible. */}
      {treeOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file tree"
          tabIndex={-1}
          onMouseDown={onResizeStart}
          onTouchStart={onResizeStart}
          className="w-3 -mx-1.5 shrink-0 cursor-col-resize group relative z-10"
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[#2a2a35] group-hover:bg-[#3a3a48] transition-colors" />
        </div>
      ) : null}

      {/* Right column: file content viewer. Lives in the same panel as
          the tree — the workspace panel still occupies one top-level
          column in the layout. */}
      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        {selected ? (
          <FileViewer
            path={selected}
            revision={revision}
            treeOpen={treeOpen}
            onShowTree={() => setTreeOpen(true)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <EmptyState
              icon={<span className="material-symbols-outlined">draft</span>}
              title={treeOpen ? 'Pick a file' : 'File tree hidden'}
              body={
                treeOpen
                  ? 'Click any file on the left to inspect its contents. The tree refreshes after every agent tool call.'
                  : 'Show the file tree to browse what the agent has written into /work.'
              }
            />
            {!treeOpen ? (
              <button
                type="button"
                onClick={() => setTreeOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#2a2a35] text-[11px] text-slate-gray hover:text-soft-white hover:border-[#3a3a45] transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">
                  left_panel_open
                </span>
                Show file tree
              </button>
            ) : null}
          </div>
        )}
      </section>

      {/* Drag-curtain — covers the EditorPane while a resize is in
          flight so the cursor stays in the `col-resize` state and
          pointer events keep landing on the window-level listeners
          even as the cursor crosses scrollable children. */}
      {isResizing ? (
        <div className="absolute inset-0 z-[2000] cursor-col-resize" aria-hidden />
      ) : null}
    </div>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}

function TreeRow({ node, depth, selected, onSelect }: TreeRowProps) {
  // Directories default-open at depth 0 so the first level of /work is
  // visible without click; deeper levels start collapsed so the tree
  // stays compact. User toggles override on each click.
  const [open, setOpen] = useState(depth === 0);
  const pad = depth * 12 + 6;

  if (node.kind === 'dir') {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-1 text-left py-0.5 hover:bg-[#2a2a35]/60 transition-colors text-slate-gray hover:text-soft-white"
          style={{ paddingLeft: pad }}
          title={node.path}
        >
          <span
            className="material-symbols-outlined text-[12px] shrink-0 transition-transform"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            chevron_right
          </span>
          <span className="material-symbols-outlined text-[12px] shrink-0">
            {open ? 'folder_open' : 'folder'}
          </span>
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children.length > 0 ? (
          <ul>
            {node.children.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  const isSelected = selected === node.path;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={[
          'w-full flex items-center gap-1 text-left py-0.5 transition-colors',
          isSelected
            ? 'bg-[#2a2a35] text-soft-white'
            : 'text-slate-gray hover:bg-[#2a2a35]/60 hover:text-soft-white',
        ].join(' ')}
        style={{ paddingLeft: pad + 14 /* align with dir name post-chevron */ }}
        title={node.path}
      >
        <span className="material-symbols-outlined text-[12px] shrink-0">
          description
        </span>
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}

interface FileViewerProps {
  path: string;
  /** Re-read the file when the tree's revision bumps so external edits
   *  (next tool call rewrites the file) show up in the viewer. */
  revision: number;
  /** Whether the file tree is currently visible. Drives whether the
   *  viewer header surfaces a "show tree" affordance. */
  treeOpen: boolean;
  /** Re-open the file tree. Called from the viewer header's
   *  `left_panel_open` button when the tree is hidden. */
  onShowTree: () => void;
}

// Scan a Uint8Array for NUL bytes — `grep -I`'s binary heuristic. We
// keep the loop explicit (no escape-sequence string literal) so the
// detection is robust against any editor / transform that mishandles
// `\0` in source.
function hasNulByte(buf: Uint8Array, limit = 1024): boolean {
  const n = Math.min(buf.length, limit);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function FileViewer({ path, revision, treeOpen, onShowTree }: FileViewerProps) {
  const [content, setContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ bytes: number; binary: boolean } | null>(null);

  const load = useCallback(() => {
    const { fs } = getRuntime();
    try {
      const raw = fs.readFileSync(path);
      const bytes = (raw as Uint8Array).byteLength ?? (raw as string).length ?? 0;
      const binary = raw instanceof Uint8Array ? hasNulByte(raw) : false;
      if (binary) {
        setContent('');
        setMeta({ bytes, binary: true });
      } else {
        const text =
          raw instanceof Uint8Array
            ? new TextDecoder('utf-8', { fatal: false }).decode(raw)
            : String(raw);
        setContent(text);
        setMeta({ bytes, binary: false });
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setContent('');
      setMeta(null);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load, revision]);

  return (
    <>
      <header className="flex items-center gap-2 px-2 py-1 border-b border-[#2a2a35] bg-sidebar-bg shrink-0">
        {!treeOpen ? (
          <button
            type="button"
            onClick={onShowTree}
            title="Show file tree"
            className="text-slate-gray hover:text-soft-white transition-colors p-0.5 shrink-0"
          >
            <span className="material-symbols-outlined text-[14px]">
              left_panel_open
            </span>
          </button>
        ) : null}
        <span
          className="flex-1 min-w-0 text-[11px] font-mono text-soft-white truncate"
          title={path}
        >
          {path}
        </span>
        {meta ? (
          <span className="text-[10px] font-mono text-slate-gray/70 shrink-0">
            {meta.binary ? 'binary' : `${meta.bytes.toLocaleString()} B`}
          </span>
        ) : null}
      </header>
      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar bg-content-bg">
        {error ? (
          <pre className="px-3 py-3 text-[12px] font-mono text-[#f0a0a0] whitespace-pre-wrap break-words">
            {error}
          </pre>
        ) : meta?.binary ? (
          <p className="px-3 py-3 text-[12px] font-mono text-slate-gray italic">
            (binary file — preview suppressed)
          </p>
        ) : (
          <pre className="px-3 py-3 text-[12px] font-mono text-soft-white/90 leading-[1.55] whitespace-pre">
            {content}
          </pre>
        )}
      </div>
    </>
  );
}
