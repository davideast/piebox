/**
 * Adapter: @platformatic/vfs → isomorphic-git FsClient (promise API)
 *
 * isomorphic-git supports two fs interfaces:
 *   1. Callback API (node:fs style)
 *   2. Promise API (via a `promises` property)
 *
 * We use the Promise API (preferred by isomorphic-git) by creating a
 * `promises` object with properly bound async methods that delegate
 * to VFS's synchronous operations.
 *
 * The key issue: @platformatic/vfs's native `promises` getter returns
 * an object whose methods don't survive `.bind()`, which causes
 * isomorphic-git's `bindFs()` to crash. We fix this by creating our
 * own `promises` object with regular functions.
 */

import type { VirtualFileSystem } from "@platformatic/vfs";

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
      return vfs.readlinkSync(filepath);
    },

    async symlink(target: string, filepath: string): Promise<void> {
      vfs.symlinkSync(target, filepath);
    },

    async chmod(_filepath: string, _mode: number): Promise<void> {
      // VFS doesn't support chmod, no-op
    },
  };

  return { promises };
}
