/**
 * createVFS() — the FS factory.
 *
 * Returns a PieboxFS implementation backed by either:
 *   • `@platformatic/vfs` in Node (default), or
 *   • `almostnode`'s VirtualFS in the browser (pass `{ backend: "browser",
 *     source: almostnodeVfs }`).
 *
 * Existing Node callers — `createVFS()`, `createVFS({ moduleHooks: false })` —
 * keep working unchanged. The browser backend is a strict addition.
 */

import { createNodeFs, type NodeBackendOptions } from "./node-backend.js";
import {
  createBrowserFs,
  type AlmostnodeVirtualFsLike,
  type BrowserBackendOptions,
} from "./browser-backend.js";
import type { PieboxFS } from "./types.js";

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
} from "./types.js";
export type { AlmostnodeVirtualFsLike } from "./browser-backend.js";
export { createNodeFs, createBrowserFs };

export type CreateVFSOptions =
  | (NodeBackendOptions & { backend?: "node" })
  | (BrowserBackendOptions & { backend: "browser" });

/**
 * Create a PieboxFS. Default is the Node backend.
 *
 * @example Node
 * ```ts
 * const fs = createVFS({ moduleHooks: false });
 * ```
 *
 * @example Browser
 * ```ts
 * import { createContainer } from "almostnode";
 * const { vfs: almostnodeVfs } = createContainer();
 * const fs = createVFS({ backend: "browser", source: almostnodeVfs });
 * ```
 */
export function create(options?: CreateVFSOptions): PieboxFS {
  if (options && options.backend === "browser") {
    return createBrowserFs({ source: options.source });
  }
  const { backend: _backend, ...rest } = (options ?? {}) as {
    backend?: "node";
  } & NodeBackendOptions;
  return createNodeFs(rest);
}
