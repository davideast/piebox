/**
 * Adapter: PieboxFS → just-bash IFileSystem
 *
 * Bridges the node:fs-compatible PieboxFS to just-bash's IFileSystem
 * interface so the Bash interpreter operates on the same in-memory
 * filesystem that isomorphic-git and Pi SDK tools use.
 *
 * Scenario A (browser, almostnode) does not currently use just-bash on
 * the host side — almostnode bundles its own internal just-bash for the
 * `node` and `npm` commands. This adapter is therefore a Node-side path
 * for now. The optional methods on PieboxFS (appendFileSync, symlinkSync,
 * readlinkSync) are present on the Node backend (@platformatic/vfs) which
 * is the only place this adapter is wired.
 */

import type { PieboxFS as VirtualFileSystem } from "../fs/index.js";
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
      // PieboxFS only declares "utf-8"/"utf8" formally; the Node backend's
      // underlying @platformatic/vfs accepts any BufferEncoding. The cast is
      // safe because bash-fs-adapter is wired only on the Node path.
      return vfs.readFileSync(path, { encoding: (encoding ?? "utf8") as "utf8" }) as string;
    },

    async readFileBuffer(path) {
      return new Uint8Array(vfs.readFileSync(path) as Buffer);
    },

    async writeFile(path, content, options?) {
      const encoding =
        typeof options === "string" ? options : (options as any)?.encoding;
      const data =
        content instanceof Uint8Array ? Buffer.from(content) : content;
      vfs.writeFileSync(path, data as string | Buffer, encoding ? ({ encoding } as any) : undefined);
    },

    async appendFile(path, content, options?) {
      const encoding =
        typeof options === "string" ? options : (options as any)?.encoding;
      const data =
        content instanceof Uint8Array ? Buffer.from(content) : content;
      if (!vfs.appendFileSync) {
        throw new Error(`ENOSYS: appendFile not supported on this FS, path '${path}'`);
      }
      vfs.appendFileSync(path, data as string | Buffer, encoding ? ({ encoding } as any) : undefined);
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
      if (!vfs.symlinkSync) {
        throw new Error(`ENOSYS: symlink not supported on this FS, path '${linkPath}'`);
      }
      vfs.symlinkSync(target, linkPath);
    },

    async link(_existingPath, _newPath) {
      // Hard links not supported by VFS backends; copy instead.
      vfs.copyFileSync(_existingPath, _newPath);
    },

    async readlink(path) {
      if (!vfs.readlinkSync) {
        throw new Error(`ENOSYS: readlink not supported on this FS, path '${path}'`);
      }
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
