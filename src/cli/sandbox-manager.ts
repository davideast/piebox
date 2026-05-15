import * as fs from "node:fs/promises";
import * as path from "node:path";
import { posix } from "node:path";
import { sandbox } from "../sandbox.js";
import { createGitUtilities } from "../git.js";
import type { SandboxInstance, SandboxOptions } from "../sandbox.js";
import { writeTarGz, readTarGz } from "./tar.js";
import type { TarEntry } from "./tar.js";

/** Runtime configuration persisted in sandbox metadata. */
export interface SandboxRuntimeConfig {
  runtime?: "node" | false;
  network?: string[];
}

/**
 * Sensible defaults — agents are capable out of the box.
 *
 * - `node` (QuickJS) is sandboxed with zero host access.
 *   Agents can run `node -e "..."`, parse JSON, analyze files.
 *
 * - npm registry (GET/HEAD only) lets agents check versions,
 *   audit deps, read package metadata.
 *
 * - CDNs for reading package source and raw GitHub files.
 *
 * Override with CLI flags or `bashOptions` escape hatch.
 * Disable with `--runtime false` or `--network ""`.
 */
export const DEFAULT_RUNTIME_CONFIG: Required<SandboxRuntimeConfig> = {
  runtime: "node",
  network: [
    "https://registry.npmjs.org",       // npm package metadata (GET/HEAD)
    "https://raw.githubusercontent.com", // raw file access for public repos
    "https://cdn.jsdelivr.net",          // package source via CDN
  ],
};

export interface SandboxMetadata {
  name: string;
  createdAt: string;
  updatedAt: string;
  gitUrl?: string;
  /** The cwd used when the sandbox was created/cloned. */
  cwd?: string;
  /** Runtime configuration (runtime, network allowlist). */
  runtimeConfig?: SandboxRuntimeConfig;
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

  async create(name: string, gitUrl?: string, runtimeConfig?: SandboxRuntimeConfig): Promise<SandboxInstance> {
    const dir = this.getSandboxDir(name);
    await fs.mkdir(dir, { recursive: true });

    const mergedConfig = this.mergeWithDefaults(runtimeConfig);

    const metadata: SandboxMetadata = {
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      gitUrl,
      runtimeConfig: mergedConfig,
    };

    await fs.writeFile(
      path.join(dir, "metadata.json"),
      JSON.stringify(metadata, null, 2)
    );

    const sb = sandbox(this.buildSandboxOptions(mergedConfig));
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

    // Read metadata for cwd and runtime config
    const metadata = await this.readMetadata(name);
    const cwd = metadata.cwd ?? "/sandbox";
    // Stored config overrides defaults — user's explicit choices win
    const runtimeConfig = this.mergeWithDefaults(metadata.runtimeConfig);

    // Try tar.gz first (new format)
    try {
      await fs.stat(tarPath);
      return await this.loadFromTar(tarPath, cwd, runtimeConfig);
    } catch {
      // Fall through to JSON
    }

    // Fall back to snapshot.json (legacy format)
    try {
      const snapshotStr = await fs.readFile(jsonPath, "utf-8");
      const snapshot = JSON.parse(snapshotStr);
      const sb = sandbox({ ...this.buildSandboxOptions(runtimeConfig), snapshot });

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
      return sandbox(this.buildSandboxOptions(runtimeConfig));
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

  private async readMetadata(name: string): Promise<SandboxMetadata> {
    try {
      const metadataStr = await fs.readFile(
        path.join(this.getSandboxDir(name), "metadata.json"),
        "utf-8"
      );
      return JSON.parse(metadataStr);
    } catch {
      return {
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Update runtime config on an existing sandbox's metadata.
   * Used when CLI flags override the stored config.
   */
  async updateRuntimeConfig(name: string, runtimeConfig: SandboxRuntimeConfig): Promise<void> {
    const metadataPath = path.join(this.getSandboxDir(name), "metadata.json");
    let metadata: SandboxMetadata;
    try {
      const str = await fs.readFile(metadataPath, "utf-8");
      metadata = JSON.parse(str);
    } catch {
      metadata = {
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    metadata.runtimeConfig = runtimeConfig;
    metadata.updatedAt = new Date().toISOString();
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Convert SandboxRuntimeConfig → SandboxOptions sugar fields.
   */
  private buildSandboxOptions(config?: SandboxRuntimeConfig): SandboxOptions | undefined {
    if (!config) return undefined;
    const hasRuntime = config.runtime === "node";
    const hasNetwork = config.network && config.network.length > 0;
    if (!hasRuntime && !hasNetwork) return undefined;
    return {
      runtime: hasRuntime ? "node" as const : undefined,
      network: hasNetwork ? config.network : undefined,
    };
  }

  /**
   * Merge stored/user config with defaults.
   * User-specified fields win. Missing fields fall back to defaults.
   * Explicit `false` or `[]` disables the default (opt-out).
   */
  private mergeWithDefaults(config?: SandboxRuntimeConfig): SandboxRuntimeConfig {
    if (!config) return { ...DEFAULT_RUNTIME_CONFIG };
    return {
      runtime: config.runtime !== undefined ? config.runtime : DEFAULT_RUNTIME_CONFIG.runtime,
      network: config.network !== undefined ? config.network : DEFAULT_RUNTIME_CONFIG.network,
    };
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

  private async loadFromTar(tarPath: string, cwd: string, runtimeConfig?: SandboxRuntimeConfig): Promise<SandboxInstance> {
    const entries = await readTarGz(tarPath);
    const sb = sandbox(this.buildSandboxOptions(runtimeConfig));

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
