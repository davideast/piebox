import type { PieboxFS as VirtualFileSystem } from "../fs/types.js";
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
