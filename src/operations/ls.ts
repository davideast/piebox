import type { VirtualFileSystem } from "@platformatic/vfs";
import type { LsOperations } from "@earendil-works/pi-coding-agent";

export function createLsOperations(vfs: VirtualFileSystem): LsOperations {
  return {
    async exists(absolutePath) {
      return vfs.existsSync(absolutePath);
    },
    async stat(absolutePath) {
      const s = vfs.statSync(absolutePath);
      return {
        isDirectory: () => s.isDirectory(),
      };
    },
    async readdir(absolutePath) {
      return vfs.readdirSync(absolutePath) as string[];
    },
  };
}
