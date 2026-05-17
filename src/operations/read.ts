import type { PieboxFS as VirtualFileSystem } from "../fs/types.js";
import type { ReadOperations } from "./types.js";

export function createReadOperations(vfs: VirtualFileSystem): ReadOperations {
  return {
    async readFile(absolutePath) {
      return vfs.readFileSync(absolutePath) as Buffer;
    },
    async access(absolutePath) {
      vfs.accessSync(absolutePath);
    },
  };
}
