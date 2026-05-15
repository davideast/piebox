/**
 * Git integration for the sandbox — powered by isomorphic-git + @platformatic/vfs.
 *
 * Provides helpers to clone repos into the VFS and query git state,
 * all in-memory. The cloned repo becomes the agent's working directory.
 */

import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { create as createVFS, type VirtualFileSystem } from "@platformatic/vfs";
import type { ProgressCallback, AuthCallback, ReadCommitResult } from "isomorphic-git";
import { createGitFsAdapter } from "./adapters/git-fs-adapter.js";

export interface CloneOptions {
  /** The URL of the remote repository. Required. */
  url: string;

  /**
   * The directory to clone into.
   * This becomes the agent's working directory.
   * @default "/sandbox"
   */
  dir?: string;

  /**
   * Pre-configured VFS instance.
   * If not provided, a new one is created with `moduleHooks: false`.
   */
  vfs?: VirtualFileSystem;

  /**
   * Which branch to checkout.
   * By default, the remote's default branch.
   */
  ref?: string;

  /**
   * Only fetch a single branch.
   * Recommended for agent workloads to minimize clone size.
   * @default true
   */
  singleBranch?: boolean;

  /**
   * Shallow clone depth.
   * Use `1` for fastest clone (only latest commit).
   * @default 1
   */
  depth?: number;

  /** Disable tag fetching. @default true */
  noTags?: boolean;

  /** Skip checkout (only fetch .git objects). @default false */
  noCheckout?: boolean;

  /** CORS proxy URL (for browser environments). */
  corsProxy?: string;

  /** Name for the remote. @default "origin" */
  remote?: string;

  /** Optional progress callback. */
  onProgress?: ProgressCallback;

  /** Optional auth callback for private repos. */
  onAuth?: AuthCallback;

  /**
   * Custom HTTP client.
   * Defaults to isomorphic-git's Node.js HTTP client.
   */
  httpClient?: object;

  /**
   * Additional headers for HTTP requests.
   * Useful for GitHub tokens: `{ Authorization: 'Bearer ghp_...' }`
   */
  headers?: Record<string, string>;
}

export interface CloneResult {
  /** The primed VFS with the cloned repo. */
  vfs: VirtualFileSystem;

  /** The directory the repo was cloned into. */
  dir: string;

  /** Utility to query git status after the agent runs. */
  git: GitUtilities;
}

/**
 * Convenience git operations bound to a VFS + dir.
 * These are non-destructive query operations the host can use
 * after the agent runs to inspect what changed.
 */
export interface GitUtilities {
  /** Get the status matrix (HEAD vs workdir vs index). */
  statusMatrix(): Promise<(string | number)[][]>;

  /** List files that the agent modified (workdir differs from HEAD). */
  modifiedFiles(): Promise<string[]>;

  /** Get the current branch name. */
  currentBranch(): Promise<string | undefined>;

  /** Get the commit log. */
  log(depth?: number): Promise<ReadCommitResult[]>;

  /** Stage a file. */
  add(filepath: string): Promise<void>;

  /** Stage all modified files. */
  addAll(): Promise<void>;

  /** Create a commit with all staged changes. */
  commit(message: string, author?: { name: string; email: string }): Promise<string>;

  /** List all branches. */
  listBranches(): Promise<string[]>;

  /** Create and checkout a new branch. */
  branch(name: string, checkout?: boolean): Promise<void>;
}

/**
 * Clone a git repository into an in-memory VFS.
 *
 * Returns the primed VFS ready to be passed to `createSandboxedSession({ vfs })`.
 *
 * @example
 * ```ts
 * import { cloneIntoSandbox, createSandboxedSession } from "./src";
 *
 * const { vfs, dir, git: gitUtils } = await cloneIntoSandbox({
 *   url: "https://github.com/user/repo",
 * });
 *
 * const { session } = await createSandboxedSession({
 *   model: getModel("google", "gemini-3-flash-preview"),
 *   vfs,
 *   cwd: dir,
 * });
 *
 * await session.prompt("Refactor the error handling in src/.");
 *
 * // See what the agent changed
 * const changed = await gitUtils.modifiedFiles();
 * console.log("Modified:", changed);
 * ```
 */
export async function cloneIntoSandbox(
  options: CloneOptions,
): Promise<CloneResult> {
  const dir = options.dir ?? "/sandbox";
  const vfs = options.vfs ?? createVFS({ moduleHooks: false });

  // Ensure the target directory exists
  try {
    vfs.mkdirSync(dir, { recursive: true });
  } catch {
    // Already exists
  }

  // Create the git-compatible fs adapter
  const gitFs = createGitFsAdapter(vfs);

  // Clone into the VFS
  await git.clone({
    fs: gitFs,
    http: (options.httpClient as any) ?? http,
    dir,
    url: options.url,
    ref: options.ref,
    singleBranch: options.singleBranch ?? true,
    depth: options.depth ?? 1,
    noTags: options.noTags ?? true,
    noCheckout: options.noCheckout ?? false,
    corsProxy: options.corsProxy,
    remote: options.remote,
    onProgress: options.onProgress,
    onAuth: options.onAuth,
    headers: { "User-Agent": "git/isomorphic-git", ...options.headers },
  });

  // Build bound git utilities
  const gitUtils = createGitUtilities(vfs, dir);

  return { vfs, dir, git: gitUtils };
}

/**
 * Create bound git utility functions for a VFS + directory pair.
 * Useful when you have an existing VFS with a git repo and want
 * the convenience methods without cloning.
 */
export function createGitUtilities(
  vfs: VirtualFileSystem,
  dir: string,
): GitUtilities {
  const gitFs = createGitFsAdapter(vfs);

  return {
    async statusMatrix() {
      return git.statusMatrix({ fs: gitFs, dir });
    },

    async modifiedFiles() {
      const matrix = await git.statusMatrix({ fs: gitFs, dir });
      // statusMatrix returns [filepath, HEAD, WORKDIR, STAGE]
      // HEAD=1, WORKDIR=2 means modified; HEAD=0 means new file
      return matrix
        .filter(([, head, workdir]) => head !== workdir)
        .map(([filepath]) => filepath as string);
    },

    async currentBranch() {
      return (
        (await git.currentBranch({ fs: gitFs, dir })) ?? undefined
      );
    },

    async log(depth = 10) {
      return git.log({ fs: gitFs, dir, depth });
    },

    async add(filepath) {
      await git.add({ fs: gitFs, dir, filepath });
    },

    async addAll() {
      const modified = await this.modifiedFiles();
      for (const filepath of modified) {
        await git.add({ fs: gitFs, dir, filepath });
      }
    },

    async commit(message, author) {
      return git.commit({
        fs: gitFs,
        dir,
        message,
        author: author ?? { name: "Sandbox Agent", email: "agent@sandbox.local" },
      });
    },

    async listBranches() {
      return git.listBranches({ fs: gitFs, dir });
    },

    async branch(name, checkout = true) {
      await git.branch({ fs: gitFs, dir, ref: name, checkout });
    },
  };
}
