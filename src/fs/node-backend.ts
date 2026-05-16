/**
 * Node backend for PieboxFS — thin wrapper over @platformatic/vfs.
 *
 * @platformatic/vfs's VirtualFileSystem already implements the full sync node:fs
 * surface piebox needs (it depends on `node:sqlite` for its store, which is why
 * it only works on Node ≥ 22). This backend is a near-passthrough; the wrapper
 * exists so the call sites depend on the PieboxFS interface, not on the
 * concrete @platformatic/vfs type.
 */

import {
  create as createPlatformaticVfs,
  type VFSOptions,
  type VirtualFileSystem as PlatformaticVFS,
} from "@platformatic/vfs";
import type { PieboxFS } from "./types.js";

export type NodeBackendOptions = VFSOptions;

/**
 * Create a Node-backed PieboxFS. Default options match piebox's previous
 * `createVFS({ moduleHooks: false })` call so existing behavior is preserved.
 */
export function createNodeFs(options?: NodeBackendOptions): PieboxFS {
  const vfs: PlatformaticVFS = createPlatformaticVfs({
    moduleHooks: false,
    ...options,
  });
  // @platformatic/vfs already implements the PieboxFS surface; cast is safe
  // because PieboxFS is a strict subset of its API.
  return vfs as unknown as PieboxFS;
}
