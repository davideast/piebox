import type { VirtualFileSystem } from "@platformatic/vfs";
import type { WriteOperations } from "@earendil-works/pi-coding-agent";

export function createWriteOperations(vfs: VirtualFileSystem): WriteOperations {
  return {
    async writeFile(absolutePath, content) {
      vfs.writeFileSync(absolutePath, content);
    },
    async mkdir(dir) {
      vfs.mkdirSync(dir, { recursive: true });
    },
  };
}
