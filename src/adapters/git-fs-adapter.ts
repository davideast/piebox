/**
 * Adapter: PieboxFS → isomorphic-git FsClient (promise API)
 *
 * isomorphic-git supports two fs interfaces:
 *   1. Callback API (node:fs style)
 *   2. Promise API (via a `promises` property)
 *
 * We use the Promise API (preferred by isomorphic-git) by creating a
 * `promises` object with properly bound async methods that delegate
 * to the sync PieboxFS surface.
 *
 * Historically this was written against @platformatic/vfs's `.promises`
 * getter, whose methods don't survive `.bind()` — which causes
 * isomorphic-git's `bindFs()` to crash. We synthesize our own `promises`
 * object with plain functions, which works for both the Node backend
 * (@platformatic/vfs) and the browser backend (almostnode), the latter
 * of which does not expose a `.promises` API at all.
 *
 * The adapter calls `readlinkSync` / `symlinkSync` only if the underlying
 * FS provides them. The browser backend throws ENOSYS for both, which is
 * the correct behavior — almostnode's VFS has no symlinks, and a Scenario
 * A clone never produces one in the workdir.
 */

import type { PieboxFS as VirtualFileSystem } from "../fs/index.js";

/**
 * Create an fs object compatible with isomorphic-git from a VirtualFileSystem.
 *
 * Uses the "promise" API path (preferred by isomorphic-git).
 */
export function createGitFsAdapter(vfs: VirtualFileSystem): any {
  // Build a promises object with plain functions that `.bind()` works on
  const promises = {
    async readFile(filepath: string, options?: any): Promise<any> {
      return vfs.readFileSync(filepath, options);
    },

    async writeFile(filepath: string, data: any, options?: any): Promise<void> {
      vfs.writeFileSync(filepath, data, options);
    },

    async unlink(filepath: string): Promise<void> {
      vfs.unlinkSync(filepath);
    },

    async readdir(filepath: string, options?: any): Promise<any> {
      return vfs.readdirSync(filepath, options);
    },

    async mkdir(filepath: string, options?: any): Promise<void> {
      vfs.mkdirSync(filepath, typeof options === 'number' ? { mode: options } : { recursive: true, ...options });
    },

    async rmdir(filepath: string): Promise<void> {
      vfs.rmdirSync(filepath);
    },

    async stat(filepath: string): Promise<any> {
      return vfs.statSync(filepath);
    },

    async lstat(filepath: string): Promise<any> {
      return vfs.lstatSync(filepath);
    },

    async readlink(filepath: string): Promise<string> {
      if (!vfs.readlinkSync) {
        const err = new Error(`ENOSYS: readlink not supported, path '${filepath}'`) as Error & { code: string };
        err.code = "ENOSYS";
        throw err;
      }
      return vfs.readlinkSync(filepath);
    },

    async symlink(target: string, filepath: string): Promise<void> {
      if (!vfs.symlinkSync) {
        const err = new Error(`ENOSYS: symlink not supported, path '${filepath}'`) as Error & { code: string };
        err.code = "ENOSYS";
        throw err;
      }
      vfs.symlinkSync(target, filepath);
    },

    async chmod(_filepath: string, _mode: number): Promise<void> {
      // VFS doesn't support chmod, no-op
    },
  };

  return { promises };
}
