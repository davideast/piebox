import type { VirtualFileSystem } from "@platformatic/vfs";
import type { ReadOperations } from "@earendil-works/pi-coding-agent";

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
