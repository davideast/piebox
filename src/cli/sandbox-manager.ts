import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sandbox } from "../sandbox.js";
import type { SandboxInstance, VFSSnapshot } from "../sandbox.js";

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
    const snapshotStr = await fs.readFile(path.join(dir, "snapshot.json"), "utf-8");
    const snapshot = JSON.parse(snapshotStr) as VFSSnapshot;

    return sandbox({ snapshot });
  }

  async save(name: string, sb: SandboxInstance): Promise<void> {
    const dir = this.getSandboxDir(name);
    await fs.mkdir(dir, { recursive: true });

    const snapshot = sb.snapshot();
    await fs.writeFile(
      path.join(dir, "snapshot.json"),
      JSON.stringify(snapshot, null, 2)
    );

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
}
