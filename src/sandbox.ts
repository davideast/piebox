/**
 * sandbox() — the primary abstraction.
 *
 * Creates a lightweight, in-memory execution environment for agents.
 * The sandbox composes three capabilities:
 *
 *   sandbox.fs     — @platformatic/vfs (node:fs-compatible)
 *   sandbox.shell  — just-bash (shell interpreter)
 *   sandbox.git    — isomorphic-git utilities (after clone)
 *
 * The sandbox's job is wiring: fs, shell, and git share
 * the same in-memory filesystem. Tools created by createSession()
 * are pre-bound to these shared instances.
 *
 * @example
 * ```ts
 * import { sandbox } from "pi-sandbox";
 * import { getModel } from "@earendil-works/pi-ai";
 *
 * const sb = sandbox();
 * await sb.clone({ url: "https://github.com/user/repo" });
 *
 * const session = await sb.createSession({
 *   model: getModel("google", "gemini-3-flash-preview"),
 * });
 * await session.prompt("Add error handling to src/");
 *
 * const modified = await sb.git.modifiedFiles();
 * ```
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AgentSession,
  AuthStorage,
  ModelRegistry,
  Skill,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  AuthStorage as AuthStorageImpl,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry as ModelRegistryImpl,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { create as createVFS, type VirtualFileSystem } from "@platformatic/vfs";
import { Bash, type BashOptions } from "just-bash";
import { createBashFsAdapter } from "./adapters/bash-fs-adapter.js";
import { createSandboxedTools } from "./tools.js";
import { loadSkillsFromVFS } from "./skills.js";
import { cloneIntoSandbox, createGitUtilities, type CloneOptions, type GitUtilities } from "./git.js";
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

  /**
   * Bash configuration (python, js, execution limits).
   * The `fs` and `cwd` fields are managed by the sandbox.
   */
  bashOptions?: Omit<BashOptions, "fs" | "cwd">;

  /**
   * Snapshot to initialize the VFS from.
   * If provided, the VFS will be populated with these files before any further setup.
   */
  snapshot?: VFSSnapshot;
}

/** Options for creating an agent session within a sandbox. */
export interface SessionOptions {
  /** Model to use. Required. */
  model: Model<any>;

  /** Thinking level for the model. */
  thinkingLevel?: ThinkingLevel;

  /**
   * Additional system prompt lines appended after the sandbox preamble.
   */
  systemPrompt?: string[];

  /**
   * Skills to inject into the agent's system prompt.
   * @default Auto-discovered from `{cwd}/.agents/skills/` in the VFS.
   * Pass `[]` to disable auto-discovery.
   */
  skills?: Skill[];

  /**
   * Additional custom tools registered alongside the sandboxed built-ins.
   * These are NOT sandboxed — they have full access to whatever they implement.
   */
  additionalTools?: ToolDefinition[];

  /** Auth storage. @default AuthStorage.create() */
  authStorage?: AuthStorage;

  /** Model registry. @default ModelRegistry.create(authStorage) */
  modelRegistry?: ModelRegistry;
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
   * Create an agent session wired to this sandbox's filesystem and shell.
   *
   * Skills are auto-discovered from `{cwd}/.agents/skills/` in the VFS
   * unless explicitly overridden via `options.skills`.
   *
   * @example
   * ```ts
   * const session = await sb.createSession({
   *   model: getModel("google", "gemini-3-flash-preview"),
   * });
   * await session.prompt("Explain this codebase.");
   * ```
   */
  createSession(options: SessionOptions): Promise<AgentSession>;

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

const SANDBOX_SYSTEM_PROMPT = [
  "You are operating in a sandboxed environment.",
  "All file operations target an in-memory virtual filesystem.",
  "The bash tool supports full shell syntax: pipes, redirections, variables, loops, and 80+ built-in commands.",
];

/**
 * Create a sandbox — a lightweight, in-memory execution environment.
 *
 * @example
 * ```ts
 * import { sandbox } from "pi-sandbox";
 *
 * const sb = sandbox();
 * sb.fs.writeFileSync("/sandbox/hello.txt", "world");
 *
 * await sb.clone({ url: "https://github.com/user/repo" });
 *
 * const session = await sb.createSession({ model });
 * await session.prompt("Refactor the code.");
 *
 * const changed = await sb.git.modifiedFiles();
 * ```
 */
export function sandbox(options?: SandboxOptions): SandboxInstance {
  const cwd = options?.cwd ?? DEFAULT_CWD;
  const vfs = options?.vfs ?? createVFS({ moduleHooks: false });
  const bashFs = createBashFsAdapter(vfs);
  const shell = new Bash({
    fs: bashFs,
    cwd,
    ...options?.bashOptions,
  });

  // Restore from snapshot if provided
  if (options?.snapshot) {
    for (const file of options.snapshot.files) {
      const dir = posix.dirname(file.path);
      try {
        vfs.mkdirSync(dir, { recursive: true });
      } catch {}
      vfs.writeFileSync(file.path, file.content, file.encoding);
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

    async createSession(sessionOptions: SessionOptions): Promise<AgentSession> {
      // Auto-discover skills from the VFS unless explicitly overridden
      let skills: Skill[];
      if (sessionOptions.skills !== undefined) {
        skills = sessionOptions.skills;
      } else {
        skills = loadSkillsFromVFS({
          vfs,
          dir: `${cwd}/.agents/skills`,
        });
      }

      const hasSkills = skills.length > 0;

      const authStorage =
        sessionOptions.authStorage ?? AuthStorageImpl.create();
      const modelRegistry =
        sessionOptions.modelRegistry ?? ModelRegistryImpl.create(authStorage);
      const settingsManager = SettingsManager.inMemory();

      const systemPromptLines = [
        ...SANDBOX_SYSTEM_PROMPT,
        ...(sessionOptions.systemPrompt ?? []),
      ];

      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: `${cwd}/.pi`,
        settingsManager,
        noExtensions: true,
        noSkills: !hasSkills,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        appendSystemPrompt: systemPromptLines,
        skillsOverride: hasSkills
          ? (current) => ({
              skills: [...current.skills, ...skills],
              diagnostics: current.diagnostics,
            })
          : undefined,
      });
      await resourceLoader.reload();

      const sandboxedTools = createSandboxedTools(cwd, vfs, shell);
      const allTools = sessionOptions.additionalTools
        ? [...sandboxedTools, ...sessionOptions.additionalTools]
        : sandboxedTools;

      const { session } = await createAgentSession({
        sessionManager: SessionManager.inMemory(),
        authStorage,
        modelRegistry,
        model: sessionOptions.model,
        thinkingLevel: sessionOptions.thinkingLevel,
        settingsManager,
        resourceLoader,
        cwd,
        noTools: "builtin",
        customTools: allTools,
      });

      return session;
    },

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
