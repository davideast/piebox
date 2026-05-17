/**
 * piebox browser entrypoint.
 *
 * Re-exports the pieces of piebox that are safe to load in a browser bundle.
 * Specifically, this entry does NOT touch the Node backend (`@platformatic/vfs`,
 * which requires `node:sqlite`) or any module that imports it transitively
 * (sandbox, session, git, tools). A future task will widen this entry as those
 * modules are made backend-agnostic.
 *
 * Use this from a browser app:
 *
 * ```ts
 * import { createContainer } from "almostnode";
 * import { createBrowserFs, createBrowserRuntime } from "piebox/browser";
 *
 * const container = createContainer();
 * const fs = createBrowserFs({ source: container.vfs });
 * const runtime = createBrowserRuntime({ container });
 * ```
 */

export { createBrowserFs } from "./fs/browser-backend.js";
export type {
  AlmostnodeVirtualFsLike,
  BrowserBackendOptions,
} from "./fs/browser-backend.js";

export type {
  PieboxFS,
  PieboxFsDirent,
  PieboxFsEncoding,
  PieboxFsMkdirOptions,
  PieboxFsReaddirOptions,
  PieboxFsReadOptions,
  PieboxFsStats,
  PieboxFsWriteOptions,
  VirtualFileSystem,
} from "./fs/types.js";

export {
  createBrowserRuntime,
  type AlmostnodeContainerLike,
  type CreateBrowserRuntimeOptions,
} from "./runtime/browser.js";

export type {
  PieboxRuntime,
  PieboxRunOptions,
  PieboxRunResult,
} from "./runtime/types.js";

// ─── Streaming pipeline (pure, browser-safe) ─────────────────────────────
export type { StreamEvent, FileEntry, StreamAdapter } from "./streaming.js";
export { NormalizerState, normalize, MultiAdapter } from "./streaming.js";

// ─── Operation factories (browser-safe; depend only on PieboxFS types) ──
// These mirror what createSandboxedTools wires on Node, but as individual
// factories so a browser consumer can compose only what it needs without
// dragging in just-bash.
export { createReadOperations } from "./operations/read.js";
export { createWriteOperations } from "./operations/write.js";
export { createEditOperations } from "./operations/edit.js";
export { createGrepOperations } from "./operations/grep.js";
export { createFindOperations } from "./operations/find.js";
export { createLsOperations } from "./operations/ls.js";
