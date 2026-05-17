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
