import type { PieboxFS as VirtualFileSystem } from "../fs/types.js";
import type { GrepOperations } from "./types.js";

export function createGrepOperations(vfs: VirtualFileSystem): GrepOperations {
  return {
    async isDirectory(absolutePath) {
      try {
        const stat = vfs.statSync(absolutePath);
        return stat.isDirectory();
      } catch {
        return false;
      }
    },
    async readFile(absolutePath) {
      return vfs.readFileSync(absolutePath, "utf8") as string;
    },
  };
}
