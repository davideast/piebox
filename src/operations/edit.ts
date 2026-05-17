import type { PieboxFS as VirtualFileSystem } from "../fs/types.js";
import type { EditOperations } from "./types.js";

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
