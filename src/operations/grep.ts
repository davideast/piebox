import type { VirtualFileSystem } from "@platformatic/vfs";
import type { GrepOperations } from "@earendil-works/pi-coding-agent";

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
