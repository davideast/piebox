/**
 * In-browser git wiring for the playground agent.
 *
 * We don't depend on piebox's git-fs-adapter directly because piebox's main
 * entry pulls @platformatic/vfs (Node-only) into the bundle. The adapter is
 * tiny, so we reproduce it inline — same pattern, same defensive Uint8Array
 * copy, same Buffer-polyfill swap that smoke-test #2 needed.
 *
 * The Buffer swap is the reason this lives behind a tiny wrapper instead of
 * being inlined into each tool handler: almostnode installs its own Buffer
 * polyfill on globalThis.Buffer, and isomorphic-git's BufferCursor picks it
 * up via the global. The two polyfills disagree on .set() bounds, so the
 * standard `buffer` package gets swapped in around every git op.
 */

import git from "isomorphic-git";
import type { PieboxFS } from "piebox/browser";

export interface GitFsLike {
  promises: Record<string, (...args: any[]) => Promise<any>>;
}

/** Build the isomorphic-git fs adapter over a PieboxFS. */
export function makeGitFs(fs: PieboxFS): GitFsLike {
  const promises = {
    readFile: async (p: string, opts?: any) => {
      const data = opts?.encoding
        ? fs.readFileSync(p, opts.encoding)
        : fs.readFileSync(p);
      return data instanceof Uint8Array ? new Uint8Array(data) : data;
    },
    writeFile: async (p: string, data: any) =>
      fs.writeFileSync(p, data instanceof Uint8Array ? new Uint8Array(data) : data),
    unlink: async (p: string) => fs.unlinkSync(p),
    readdir: async (p: string) => fs.readdirSync(p),
    mkdir: async (p: string) => fs.mkdirSync(p, { recursive: true }),
    rmdir: async (p: string) => fs.rmdirSync(p),
    stat: async (p: string) => fs.statSync(p),
    lstat: async (p: string) => fs.lstatSync(p),
    readlink: async (p: string) => {
      if (!fs.readlinkSync) throw Object.assign(new Error("ENOSYS"), { code: "ENOSYS" });
      return fs.readlinkSync(p);
    },
    symlink: async (_t: string, p: string) => {
      if (!fs.symlinkSync) throw Object.assign(new Error("ENOSYS"), { code: "ENOSYS" });
      fs.symlinkSync(_t, p);
    },
    chmod: async () => {},
  };
  return { promises };
}

/**
 * Run a git op with the standard `buffer` polyfill swapped onto globalThis.
 * isomorphic-git's BufferCursor + GitIndex serialization disagree with
 * almostnode's Buffer polyfill on .set() bounds; the swap restores parity.
 */
export async function withBufferSwap<T>(fn: () => Promise<T>): Promise<T> {
  const { Buffer: StdBuffer } = await import("buffer");
  const saved = (globalThis as any).Buffer;
  (globalThis as any).Buffer = StdBuffer;
  try {
    return await fn();
  } finally {
    (globalThis as any).Buffer = saved;
  }
}

// ── High-level operations exposed as tools ─────────────────────────────────

export interface GitContext { fs: PieboxFS; dir: string }

export async function gitInit(ctx: GitContext, defaultBranch = "main"): Promise<void> {
  const gitFs = makeGitFs(ctx.fs);
  await withBufferSwap(() => git.init({ fs: gitFs as any, dir: ctx.dir, defaultBranch }));
}

export async function gitStatus(ctx: GitContext): Promise<Array<{ path: string; status: string }>> {
  const gitFs = makeGitFs(ctx.fs);
  return withBufferSwap(async () => {
    const matrix = await git.statusMatrix({ fs: gitFs as any, dir: ctx.dir });
    return matrix
      .filter(([, head, work]) => head !== work)
      .map(([p, head, work, stage]) => ({
        path: String(p),
        status: classify(head, work, stage),
      }));
  });
}

function classify(head: number, work: number, stage: number): string {
  if (head === 0 && work === 2) return stage === 0 ? "untracked" : "added";
  if (head === 1 && work === 0) return "deleted";
  if (head === 1 && work === 2) return stage === 1 ? "modified" : "modified (staged)";
  return `${head}${work}${stage}`;
}

export async function gitAdd(ctx: GitContext, filepath: string): Promise<void> {
  const gitFs = makeGitFs(ctx.fs);
  await withBufferSwap(() => git.add({ fs: gitFs as any, dir: ctx.dir, filepath }));
}

export async function gitAddAll(ctx: GitContext): Promise<string[]> {
  const gitFs = makeGitFs(ctx.fs);
  return withBufferSwap(async () => {
    const matrix = await git.statusMatrix({ fs: gitFs as any, dir: ctx.dir });
    const touched: string[] = [];
    for (const [p, head, work] of matrix) {
      if (head !== work) {
        await git.add({ fs: gitFs as any, dir: ctx.dir, filepath: String(p) });
        touched.push(String(p));
      }
    }
    return touched;
  });
}

export async function gitCommit(
  ctx: GitContext,
  message: string,
  author?: { name: string; email: string },
): Promise<string> {
  const gitFs = makeGitFs(ctx.fs);
  return withBufferSwap(() =>
    git.commit({
      fs: gitFs as any,
      dir: ctx.dir,
      message,
      author: author ?? { name: "Sandbox Agent", email: "agent@piebox.local" },
    }),
  );
}

export async function gitLog(ctx: GitContext, depth = 10): Promise<Array<{ oid: string; message: string; author: string }>> {
  const gitFs = makeGitFs(ctx.fs);
  return withBufferSwap(async () => {
    const entries = await git.log({ fs: gitFs as any, dir: ctx.dir, depth });
    return entries.map((e) => ({
      oid: e.oid,
      message: e.commit.message.trim(),
      author: `${e.commit.author.name} <${e.commit.author.email}>`,
    }));
  });
}

export async function gitBranch(
  ctx: GitContext,
  name: string,
  checkout: boolean,
): Promise<void> {
  const gitFs = makeGitFs(ctx.fs);
  await withBufferSwap(() =>
    git.branch({ fs: gitFs as any, dir: ctx.dir, ref: name, checkout }),
  );
}

export async function gitListBranches(ctx: GitContext): Promise<string[]> {
  const gitFs = makeGitFs(ctx.fs);
  return withBufferSwap(() => git.listBranches({ fs: gitFs as any, dir: ctx.dir }));
}

export async function gitCurrentBranch(ctx: GitContext): Promise<string | undefined> {
  const gitFs = makeGitFs(ctx.fs);
  return withBufferSwap(async () => {
    const b = await git.currentBranch({ fs: gitFs as any, dir: ctx.dir });
    return b ?? undefined;
  });
}
