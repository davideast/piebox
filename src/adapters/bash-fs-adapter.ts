/**
 * Adapter: @platformatic/vfs → just-bash IFileSystem
 *
 * Bridges the node:fs-compatible VirtualFileSystem to just-bash's
 * IFileSystem interface so the Bash interpreter operates on the
 * same in-memory filesystem that isomorphic-git and Pi SDK tools use.
 */

import type { VirtualFileSystem } from "@platformatic/vfs";
import type {
  IFileSystem,
  FsStat,
  MkdirOptions,
  RmOptions,
  CpOptions,
} from "just-bash";

interface DirentEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}
import * as nodePath from "node:path";

export function createBashFsAdapter(vfs: VirtualFileSystem): IFileSystem {
  return {
    async readFile(path, options?) {
      const encoding =
        typeof options === "string" ? options : options?.encoding ?? "utf8";
      return vfs.readFileSync(path, { encoding: encoding ?? "utf8" }) as string;
    },

    async readFileBuffer(path) {
      return new Uint8Array(vfs.readFileSync(path) as Buffer);
    },

    async writeFile(path, content, options?) {
      const encoding =
        typeof options === "string" ? options : (options as any)?.encoding;
      const data =
        content instanceof Uint8Array ? Buffer.from(content) : content;
      vfs.writeFileSync(path, data as string | Buffer, encoding ? { encoding } : undefined);
    },

    async appendFile(path, content, options?) {
      const encoding =
        typeof options === "string" ? options : (options as any)?.encoding;
      const data =
        content instanceof Uint8Array ? Buffer.from(content) : content;
      vfs.appendFileSync(path, data as string | Buffer, encoding ? { encoding } : undefined);
    },

    async exists(path) {
      return vfs.existsSync(path);
    },

    async stat(path): Promise<FsStat> {
      const s = vfs.statSync(path);
      return {
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        isSymbolicLink: s.isSymbolicLink(),
        mode: s.mode,
        size: s.size,
        mtime: s.mtime,
      };
    },

    async mkdir(path, options?: MkdirOptions) {
      vfs.mkdirSync(path, options);
    },

    async readdir(path) {
      return vfs.readdirSync(path) as string[];
    },

    async readdirWithFileTypes(path): Promise<DirentEntry[]> {
      const entries = vfs.readdirSync(path, { withFileTypes: true });
      return (entries as any[]).map((e) => ({
        name: e.name,
        isFile: e.isFile(),
        isDirectory: e.isDirectory(),
        isSymbolicLink: e.isSymbolicLink(),
      }));
    },

    async rm(path, options?: RmOptions) {
      try {
        const s = vfs.statSync(path);
        if (s.isDirectory()) {
          if (options?.recursive) {
            // Recursively remove contents then the dir
            const entries = vfs.readdirSync(path) as string[];
            for (const entry of entries) {
              await this.rm!(`${path}/${entry}`, { recursive: true, force: true });
            }
            vfs.rmdirSync(path);
          } else {
            vfs.rmdirSync(path);
          }
        } else {
          vfs.unlinkSync(path);
        }
      } catch (err) {
        if (!options?.force) throw err;
      }
    },

    async cp(src, dest, options?: CpOptions) {
      vfs.copyFileSync(src, dest);
    },

    async mv(src, dest) {
      vfs.renameSync(src, dest);
    },

    resolvePath(base, inputPath) {
      if (nodePath.isAbsolute(inputPath)) return nodePath.normalize(inputPath);
      return nodePath.resolve(base, inputPath);
    },

    getAllPaths() {
      // Walk the VFS recursively from root to collect all paths
      const paths: string[] = [];
      const walk = (dir: string) => {
        try {
          const entries = vfs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries as any[]) {
            const fullPath = dir === "/" ? `/${entry.name}` : `${dir}/${entry.name}`;
            paths.push(fullPath);
            if (entry.isDirectory()) {
              walk(fullPath);
            }
          }
        } catch {
          // Directory doesn't exist or isn't readable
        }
      };
      walk("/");
      return paths;
    },

    async chmod(_path, _mode) {
      // VFS doesn't support chmod in a meaningful way, no-op
    },

    async symlink(target, linkPath) {
      vfs.symlinkSync(target, linkPath);
    },

    async link(_existingPath, _newPath) {
      // Hard links not supported by @platformatic/vfs, copy instead
      vfs.copyFileSync(_existingPath, _newPath);
    },

    async readlink(path) {
      return vfs.readlinkSync(path);
    },

    async lstat(path): Promise<FsStat> {
      const s = vfs.lstatSync(path);
      return {
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        isSymbolicLink: s.isSymbolicLink(),
        mode: s.mode,
        size: s.size,
        mtime: s.mtime,
      };
    },

    async realpath(path) {
      return vfs.realpathSync(path);
    },

    async utimes(_path, _atime, _mtime) {
      // Not supported by @platformatic/vfs, no-op
    },
  };
}
