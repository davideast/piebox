/**
 * sandbox() — the primary substrate abstraction.
 *
 * Creates a lightweight, in-memory execution environment. The sandbox
 * composes three capabilities:
 *
 *   sandbox.fs     — @platformatic/vfs (node:fs-compatible)
 *   sandbox.shell  — just-bash (shell interpreter)
 *   sandbox.git    — isomorphic-git utilities (after clone)
 *
 * The sandbox's job is wiring: fs, shell, and git share the same
 * in-memory filesystem.
 *
 * Agent-loop concerns (session, skills, tools-for-LLM) moved to
 * `@piebox/driver-agent` in Step 5 of the composable-sandbox
 * migration plan. The pre-Step-5 `sandbox().createSession({ model })`
 * method is now `createSandboxedSession({ model, vfs, bash, cwd })`
 * imported from `@piebox/driver-agent`.
 *
 * @example
 * ```ts
 * import { sandbox } from "piebox";
 * import { createSandboxedSession } from "@piebox/driver-agent";
 * import { getModel } from "@earendil-works/pi-ai";
 *
 * const sb = sandbox();
 * await sb.clone({ url: "https://github.com/user/repo" });
 *
 * const { session } = await createSandboxedSession({
 *   model: getModel("google", "gemini-3-flash-preview"),
 *   vfs: sb.fs,
 *   bash: sb.shell,
 *   cwd: sb.cwd,
 * });
 * await session.prompt("Add error handling to src/");
 *
 * const modified = await sb.git.modifiedFiles();
 * ```
 */

import { create as createVFS } from "./fs/index.js";
import type { PieboxFS as VirtualFileSystem } from "./fs/index.js";
import { Bash, type BashOptions } from "just-bash";
import type { AllowedUrlEntry } from "just-bash";
import { createBashFsAdapter } from "./adapters/bash-fs-adapter.js";
import { cloneIntoSandbox, type CloneOptions, type GitUtilities } from "./git.js";
import {
  resolveSecrets,
  generateBootstrap,
  SecretsScrubber,
  type SecretsConfig,
} from "./secrets.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname, posix } from "node:path";

// ─── Public Types ───────────────────────────────────────────────────────────

/** Serialized representation of an entire VFS state. */
export interface VFSSnapshot {
  version: 1;
  files: Array<{
    path: string;
    content: string;
    encoding: "utf-8" | "base64";
  }>;
}

/** Options for exporting VFS contents to the host filesystem. */
export interface ExportOptions {
  include?: string[];
}

/** Result of an export operation. */
export interface ExportResult {
  filesWritten: number;
  bytesWritten: number;
  paths: string[];
}

/** Options for creating a sandbox environment. */
export interface SandboxOptions {
  /**
   * Virtual working directory.
   * All tool operations are scoped to this path.
   * @default "/sandbox"
   */
  cwd?: string;

  /**
   * Pre-configured VFS instance.
   * When provided, the sandbox uses this instead of creating a new one.
   */
  vfs?: VirtualFileSystem;

  // ─── Sugar (high-level, declarative) ─────────

  /**
   * Enable a runtime for the sandbox shell.
   *
   * - `'node'`  — enables `node` and `js-exec` commands (QuickJS).
   *               Agent can run `node -e "..."` and `node script.js`.
   * - `false`   — no JS runtime (default).
   *
   * For advanced JS config (bootstrap code, tool bridges),
   * use `bashOptions.javascript` instead.
   */
  runtime?: "node" | false;

  /**
   * Secrets configuration.
   *
   * Two injection modes with different security properties:
   *
   * **Expose** — agent sees the raw value in `process.env`.
   * Values are scrubbed from all output (logs, snapshots, URLs).
   * Use only when agent code must manipulate the secret directly.
   *
   * **Broker** — credentials injected at the network boundary.
   * Agent never sees the raw value. Preferred for HTTP auth.
   *
   * @example
   * ```ts
   * // Shorthand: expose only (reads from process.env)
   * secrets: ['OPENAI_API_KEY']
   *
   * // Full: expose + broker
   * secrets: {
   *   expose: ['OPENAI_API_KEY'],
   *   broker: {
   *     'https://api.github.com': {
   *       Authorization: `Bearer ${ghToken}`,
   *     },
   *   },
   * }
   * ```
   *
   * For custom bootstrap injection or tool bridges,
   * use `bashOptions.javascript` instead.
   */
  secrets?: SecretsConfig;

  /**
   * Network origins the agent can reach.
   *
   * String entries allow GET/HEAD to that origin.
   * Brokered origins (from `secrets.broker`) are automatically included.
   * Defaults to no network access.
   *
   * @example
   * ```ts
   * network: [
   *   'https://registry.npmjs.org',
   *   'https://api.openai.com',
   * ]
   * ```
   *
   * For full control (POST methods, custom timeouts, SSRF config),
   * use `bashOptions.network` instead.
   */
  network?: string[];

  // ─── Escape Hatch (low-level, full control) ──

  /**
   * Raw just-bash configuration.
   * Use when the sugar options don't cover your case.
   *
   * If both sugar and bashOptions configure the same concern,
   * bashOptions wins (escape hatch overrides sugar).
   */
  bashOptions?: Omit<BashOptions, "fs" | "cwd">;

  /**
   * Snapshot to initialize the VFS from.
   * If provided, the VFS will be populated with these files before any further setup.
   */
  snapshot?: VFSSnapshot;
}

/** The sandbox instance — a composable, in-memory execution environment. */
export interface SandboxInstance {
  /** The in-memory filesystem. node:fs-compatible. */
  readonly fs: VirtualFileSystem;

  /** The shell interpreter. Operates on the same filesystem. */
  readonly shell: Bash;

  /** The virtual working directory. */
  readonly cwd: string;

  /**
   * Secrets scrubber — replaces exposed secret values with `[NAME]`.
   * Use to scrub output before writing to logs or displaying to the user.
   * `null` when no exposed secrets are configured.
   */
  readonly scrubber: SecretsScrubber | null;

  /**
   * Git utilities. `null` until `clone()` is called.
   * Provides statusMatrix, modifiedFiles, commit, branch, etc.
   */
  git: GitUtilities | null;

  /**
   * Clone a git repository into the sandbox's filesystem.
   * After cloning, `sandbox.git` is populated with bound utilities.
   *
   * @example
   * ```ts
   * await sb.clone({ url: "https://github.com/user/repo" });
   * const branch = await sb.git.currentBranch();
   * ```
   */
  clone(options: SandboxCloneOptions): Promise<void>;

  /**
   * Take a snapshot of the current VFS state.
   * Can be passed to `sandbox({ snapshot })` to restore the state later.
   */
  snapshot(): VFSSnapshot;

  /**
   * Export the sandbox VFS contents to the host filesystem.
   *
   * @param dir The destination directory on the host filesystem.
   * @param options Additional export options (e.g. glob filters).
   */
  export(dir: string, options?: ExportOptions): Promise<ExportResult>;
}

/** Clone options scoped to the sandbox (url is required, dir defaults to cwd). */
export type SandboxCloneOptions = Omit<CloneOptions, "dir" | "vfs">;

// ─── Implementation ─────────────────────────────────────────────────────────

const DEFAULT_CWD = "/sandbox";

/**
 * Create a sandbox — a lightweight, in-memory execution environment.
 *
 * Agent-loop integration moved to `@piebox/driver-agent` in Step 5
 * of the composable-sandbox migration plan. Pass the sandbox's fs,
 * shell, and cwd into `createSandboxedSession` from the driver
 * package to bind an agent loop.
 *
 * @example
 * ```ts
 * import { sandbox } from "piebox";
 *
 * const sb = sandbox();
 * sb.fs.writeFileSync("/sandbox/hello.txt", "world");
 *
 * await sb.clone({ url: "https://github.com/user/repo" });
 *
 * // To run an agent against this sandbox:
 * //   import { createSandboxedSession } from "@piebox/driver-agent";
 * //   const { session } = await createSandboxedSession({
 * //     model, vfs: sb.fs, bash: sb.shell, cwd: sb.cwd,
 * //   });
 *
 * const changed = await sb.git?.modifiedFiles();
 * ```
 */
export function sandbox(options?: SandboxOptions): SandboxInstance {
  const cwd = options?.cwd ?? DEFAULT_CWD;
  const vfs = options?.vfs ?? createVFS({ moduleHooks: false });
  const bashFs = createBashFsAdapter(vfs);

  // ─── Compile sugar into bashOptions ───────────
  const bashOptions: Omit<BashOptions, "fs" | "cwd"> = {
    ...(options?.bashOptions ?? {}),
  };

  // Resolve secrets
  const resolvedSecrets = resolveSecrets(options?.secrets);

  // runtime: 'node' → enable javascript (unless escape hatch overrides)
  if (options?.runtime === "node" && !bashOptions.javascript) {
    bashOptions.javascript = true;
  }

  // secrets.expose → QuickJS bootstrap code
  if (resolvedSecrets.expose.size > 0) {
    const bootstrap = generateBootstrap(resolvedSecrets.expose, cwd);

    if (bashOptions.javascript === true) {
      bashOptions.javascript = { bootstrap };
    } else if (
      typeof bashOptions.javascript === "object" &&
      bashOptions.javascript
    ) {
      // Append to existing bootstrap (escape hatch + sugar compose)
      bashOptions.javascript = {
        ...bashOptions.javascript,
        bootstrap:
          (bashOptions.javascript.bootstrap ?? "") + "\n" + bootstrap,
      };
    } else if (!bashOptions.javascript) {
      // Enable javascript if secrets.expose is set but runtime wasn't
      bashOptions.javascript = { bootstrap };
    }
  }

  // secrets.broker + network → allowedUrlPrefixes (unless escape hatch overrides)
  if (!bashOptions.network) {
    const prefixes: AllowedUrlEntry[] = [];
    const brokeredOrigins = new Set<string>();

    // Brokered origins (with credential injection)
    for (const [origin, headers] of Array.from(resolvedSecrets.broker)) {
      prefixes.push({
        url: origin,
        transform: [{ headers }],
      });
      brokeredOrigins.add(origin);
    }

    // Plain network origins (no credentials)
    for (const origin of options?.network ?? []) {
      if (!brokeredOrigins.has(origin)) {
        prefixes.push(origin);
      }
    }

    if (prefixes.length > 0) {
      bashOptions.network = {
        allowedUrlPrefixes: prefixes,
        allowedMethods: ["GET", "HEAD"],
        denyPrivateRanges: true,
      };
    }
  }

  // ─── Create scrubber for exposed secrets ──────
  const scrubber = new SecretsScrubber();
  for (const [name, value] of Array.from(resolvedSecrets.expose)) {
    scrubber.register(name, value);
  }

  const shell = new Bash({
    fs: bashFs,
    cwd,
    ...bashOptions,
  });

  // Restore from snapshot if provided
  if (options?.snapshot) {
    for (const file of options.snapshot.files) {
      const dir = posix.dirname(file.path);
      try {
        vfs.mkdirSync(dir, { recursive: true });
      } catch {}
      if (file.encoding === "base64") {
        vfs.writeFileSync(file.path, Buffer.from(file.content, "base64"));
      } else {
        vfs.writeFileSync(file.path, file.content);
      }
    }
  }

  // Ensure cwd exists
  try {
    vfs.mkdirSync(cwd, { recursive: true });
  } catch {
    // Already exists
  }

  // Mutable git state — populated by clone()
  let git: GitUtilities | null = null;

  return {
    fs: vfs,
    shell,
    cwd,
    scrubber: scrubber.active ? scrubber : null,

    get git() {
      return git;
    },
    set git(value: GitUtilities | null) {
      git = value;
    },

    async clone(cloneOptions: SandboxCloneOptions): Promise<void> {
      const result = await cloneIntoSandbox({
        ...cloneOptions,
        dir: cwd,
        vfs,
      });
      git = result.git;
    },

    // Note: pre-Step-5 piebox exposed `createSession` here. The
    // agent-loop integration moved to `@piebox/driver-agent`'s
    // `createSandboxedSession` in Step 5 of the composable-sandbox
    // migration plan (see docs/investigations/G-migration.md).
    // Pass `{ vfs: sb.fs, bash: sb.shell, cwd: sb.cwd }` to bind the
    // driver to this sandbox's substrate.

    snapshot(): VFSSnapshot {
      const files: VFSSnapshot["files"] = [];
      const walk = (dir: string) => {
        let entries;
        try {
          entries = vfs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = posix.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            try {
              const content = vfs.readFileSync(fullPath, "utf-8");
              files.push({
                path: fullPath,
                content: content.toString(),
                encoding: "utf-8",
              });
            } catch {
              // Ignore unreadable files
            }
          }
        }
      };

      walk("/");

      return {
        version: 1,
        files,
      };
    },

    async export(dir: string, exportOptions?: ExportOptions): Promise<ExportResult> {
      let filesWritten = 0;
      let bytesWritten = 0;
      const paths: string[] = [];

      const walkExport = async (vfsDir: string) => {
        let entries;
        try {
          entries = vfs.readdirSync(vfsDir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          const vfsPath = posix.join(vfsDir, entry.name);
          const relativePath = posix.relative("/", vfsPath);
          const hostPath = join(dir, relativePath);

          if (entry.isDirectory()) {
            await walkExport(vfsPath);
          } else if (entry.isFile()) {
            if (exportOptions?.include && exportOptions.include.length > 0) {
              const matches = exportOptions.include.some(pattern => {
                const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
                return regex.test(relativePath) || regex.test(vfsPath);
              });
              if (!matches) continue;
            }

            try {
              const content = vfs.readFileSync(vfsPath, "utf-8");
              await mkdir(dirname(hostPath), { recursive: true });
              await writeFile(hostPath, content, "utf-8");
              filesWritten++;
              bytesWritten += Buffer.byteLength(content, "utf-8");
              paths.push(hostPath);
            } catch {
              // ignore
            }
          }
        }
      };

      await walkExport("/");

      return { filesWritten, bytesWritten, paths };
    },
  };
}
