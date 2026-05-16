import type { PieboxFS as VirtualFileSystem } from "../fs/index.js";
import type { EditOperations } from "@earendil-works/pi-coding-agent";

export function createEditOperations(vfs: VirtualFileSystem): EditOperations {
  return {
    async readFile(absolutePath) {
      return vfs.readFileSync(absolutePath) as Buffer;
    },
    async writeFile(absolutePath, content) {
      vfs.writeFileSync(absolutePath, content);
    },
    async access(absolutePath) {
      vfs.accessSync(absolutePath);
    },
  };
}
