import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { posix } from "node:path";
import { sandbox } from "../sandbox.js";
import type { SandboxInstance } from "../sandbox.js";
import { writeTarGz, readTarGz } from "./tar.js";
import type { TarEntry } from "./tar.js";

export interface SandboxMetadata {
  name: string;
  createdAt: string;
  updatedAt: string;
  gitUrl?: string;
}

export class SandboxManager {
  private baseDir: string;

  constructor(baseDir: string = ".piebox/sandboxes") {
    this.baseDir = baseDir;
  }

  private getSandboxDir(name: string): string {
    return path.join(this.baseDir, name);
  }

  async exists(name: string): Promise<boolean> {
    try {
      await fs.stat(this.getSandboxDir(name));
      return true;
    } catch {
      return false;
    }
  }

  async create(name: string, gitUrl?: string): Promise<SandboxInstance> {
    const dir = this.getSandboxDir(name);
    await fs.mkdir(dir, { recursive: true });

    const metadata: SandboxMetadata = {
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      gitUrl,
    };

    await fs.writeFile(
      path.join(dir, "metadata.json"),
      JSON.stringify(metadata, null, 2)
    );

    const sb = sandbox();
    await this.save(name, sb);
    return sb;
  }

  async load(name: string): Promise<SandboxInstance> {
    if (!(await this.exists(name))) {
      throw new Error(`Sandbox ${name} not found`);
    }

    const dir = this.getSandboxDir(name);
    const tarPath = path.join(dir, "snapshot.tar.gz");
    const jsonPath = path.join(dir, "snapshot.json");

    // Try tar.gz first (new format)
    try {
      await fs.stat(tarPath);
      return await this.loadFromTar(tarPath);
    } catch {
      // Fall through to JSON
    }

    // Fall back to snapshot.json (legacy format)
    try {
      const snapshotStr = await fs.readFile(jsonPath, "utf-8");
      const snapshot = JSON.parse(snapshotStr);
      const sb = sandbox({ snapshot });

      // Auto-migrate: save as tar.gz, delete JSON
      await this.save(name, sb);
      try {
        await fs.unlink(jsonPath);
      } catch {
        // Ignore cleanup errors
      }

      return sb;
    } catch {
      // No snapshot at all — return empty sandbox
      return sandbox();
    }
  }

  async save(name: string, sb: SandboxInstance): Promise<void> {
    const dir = this.getSandboxDir(name);
    await fs.mkdir(dir, { recursive: true });

    // Walk VFS and collect entries
    const entries: TarEntry[] = [];
    this.walkVFS(sb, "/", (filePath, content) => {
      entries.push({
        path: filePath,
        content: Buffer.from(content, "utf-8"),
      });
    });

    // Atomic write: temp file → rename
    const tmpPath = path.join(dir, "snapshot.tar.gz.tmp");
    const finalPath = path.join(dir, "snapshot.tar.gz");

    await writeTarGz(tmpPath, entries);
    await fs.rename(tmpPath, finalPath);

    // Update metadata
    const metadataPath = path.join(dir, "metadata.json");
    let metadata: SandboxMetadata;
    try {
      const metadataStr = await fs.readFile(metadataPath, "utf-8");
      metadata = JSON.parse(metadataStr);
      metadata.updatedAt = new Date().toISOString();
    } catch {
      metadata = {
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  async list(): Promise<SandboxMetadata[]> {
    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      const sandboxes: SandboxMetadata[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const metadataStr = await fs.readFile(
              path.join(this.baseDir, entry.name, "metadata.json"),
              "utf-8"
            );
            sandboxes.push(JSON.parse(metadataStr));
          } catch {
            // Ignore corrupted sandbox
          }
        }
      }
      return sandboxes;
    } catch {
      return [];
    }
  }

  async destroy(name: string): Promise<void> {
    const dir = this.getSandboxDir(name);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async loadFromTar(tarPath: string): Promise<SandboxInstance> {
    const entries = await readTarGz(tarPath);
    const sb = sandbox();

    for (const entry of entries) {
      const dir = posix.dirname(entry.path);
      try {
        sb.fs.mkdirSync(dir, { recursive: true });
      } catch {
        // Directory may already exist
      }
      sb.fs.writeFileSync(entry.path, entry.content.toString("utf-8"));
    }

    return sb;
  }

  private walkVFS(
    sb: SandboxInstance,
    dir: string,
    callback: (path: string, content: string) => void,
  ): void {
    try {
      const entries = sb.fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = posix.join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            this.walkVFS(sb, fullPath, callback);
          } else if (entry.isFile()) {
            const content = sb.fs.readFileSync(fullPath, "utf-8") as string;
            callback(fullPath, content);
          }
        } catch {
          // skip unreadable entries
        }
      }
    } catch {
      // empty directory or error
    }
  }
}
