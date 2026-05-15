import type { VirtualFileSystem } from "@platformatic/vfs";
import type { FindOperations } from "@earendil-works/pi-coding-agent";

/**
 * Recursively collect all file paths from the VFS under a given root.
 */
function collectPaths(vfs: VirtualFileSystem, dir: string): string[] {
  const paths: string[] = [];
  try {
    const entries = vfs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = dir === "/" ? `/${entry.name}` : `${dir}/${entry.name}`;
      paths.push(fullPath);
      if (entry.isDirectory()) {
        paths.push(...collectPaths(vfs, fullPath));
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }
  return paths;
}

export function createFindOperations(vfs: VirtualFileSystem): FindOperations {
  return {
    async exists(absolutePath) {
      return vfs.existsSync(absolutePath);
    },
    glob(pattern, cwd, options) {
      const allPaths = collectPaths(vfs, "/");
      const cwdPrefix = cwd.endsWith("/") ? cwd : cwd + "/";
      const regex = new RegExp(
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "§GLOBSTAR§")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, "[^/]")
          .replace(/§GLOBSTAR§/g, ".*"),
      );
      return allPaths
        .filter((f) => f.startsWith(cwdPrefix) && regex.test(f))
        .slice(0, options.limit);
    },
  };
}
