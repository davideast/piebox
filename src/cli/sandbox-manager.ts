import * as fs from "node:fs/promises";
import * as path from "node:path";
import { posix } from "node:path";
import { sandbox } from "../sandbox.js";
import { createGitUtilities } from "../git.js";
import type { SandboxInstance } from "../sandbox.js";
import { writeTarGz, readTarGz } from "./tar.js";
import type { TarEntry } from "./tar.js";

export interface SandboxMetadata {
  name: string;
  createdAt: string;
  updatedAt: string;
  gitUrl?: string;
  /** The cwd used when the sandbox was created/cloned. */
  cwd?: string;
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

    // Read metadata for cwd
    const cwd = await this.readCwd(name);

    // Try tar.gz first (new format)
    try {
      await fs.stat(tarPath);
      return await this.loadFromTar(tarPath, cwd);
    } catch {
      // Fall through to JSON
    }

    // Fall back to snapshot.json (legacy format)
    try {
      const snapshotStr = await fs.readFile(jsonPath, "utf-8");
      const snapshot = JSON.parse(snapshotStr);
      const sb = sandbox({ snapshot });

      // Re-initialize git if .git/ exists
      this.initGitIfPresent(sb, cwd);

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

    // Walk VFS and collect entries — preserving binary data
    const entries: TarEntry[] = [];
    this.walkVFS(sb, "/", (filePath, content) => {
      entries.push({ path: filePath, content });
    });

    // Atomic write: temp file → rename
    const tmpPath = path.join(dir, "snapshot.tar.gz.tmp");
    const finalPath = path.join(dir, "snapshot.tar.gz");

    await writeTarGz(tmpPath, entries);
    await fs.rename(tmpPath, finalPath);

    // Update metadata (preserve cwd for git re-init on load)
    const metadataPath = path.join(dir, "metadata.json");
    let metadata: SandboxMetadata;
    try {
      const metadataStr = await fs.readFile(metadataPath, "utf-8");
      metadata = JSON.parse(metadataStr);
      metadata.updatedAt = new Date().toISOString();
      metadata.cwd = metadata.cwd ?? sb.cwd;
    } catch {
      metadata = {
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: sb.cwd,
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

  private async readCwd(name: string): Promise<string> {
    try {
      const metadataStr = await fs.readFile(
        path.join(this.getSandboxDir(name), "metadata.json"),
        "utf-8"
      );
      const metadata: SandboxMetadata = JSON.parse(metadataStr);
      return metadata.cwd ?? "/sandbox";
    } catch {
      return "/sandbox";
    }
  }

  /**
   * If the VFS contains a `.git/HEAD` file, re-initialize GitUtilities.
   * This restores git operations (diff, commit, branch) after a load.
   */
  private initGitIfPresent(sb: SandboxInstance, cwd: string): void {
    try {
      sb.fs.statSync(`${cwd}/.git/HEAD`);
      sb.git = createGitUtilities(sb.fs, cwd);
    } catch {
      // No git state — leave sb.git as null
    }
  }

  private async loadFromTar(tarPath: string, cwd: string): Promise<SandboxInstance> {
    const entries = await readTarGz(tarPath);
    const sb = sandbox();

    for (const entry of entries) {
      const dir = posix.dirname(entry.path);
      try {
        sb.fs.mkdirSync(dir, { recursive: true });
      } catch {
        // Directory may already exist
      }

      // Write as Buffer to preserve binary content (git packfiles, index)
      sb.fs.writeFileSync(entry.path, entry.content);
    }

    // Re-initialize git if .git/ exists in the restored VFS
    this.initGitIfPresent(sb, cwd);

    return sb;
  }

  /**
   * Walk the VFS and collect file contents as Buffers.
   * Reading without encoding returns the raw Buffer, preserving binary data
   * (critical for git packfiles, index, and any non-text files).
   */
  private walkVFS(
    sb: SandboxInstance,
    dir: string,
    callback: (path: string, content: Buffer) => void,
  ): void {
    try {
      const entries = sb.fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = posix.join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            this.walkVFS(sb, fullPath, callback);
          } else if (entry.isFile()) {
            // Read without encoding to get raw Buffer — preserves binary
            const raw = sb.fs.readFileSync(fullPath);
            const content = Buffer.isBuffer(raw)
              ? raw
              : Buffer.from(String(raw), "utf-8");
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
