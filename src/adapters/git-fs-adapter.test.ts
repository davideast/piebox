/**
 * Smoke test: isomorphic-git consumes the PieboxFS interface via the
 * git-fs-adapter, with the Node backend (the existing Node code path).
 *
 * This is the regression guard for step 4 — "isomorphic-git consumes the FS
 * interface; a basic git op works in Node."
 */

import { describe, it, expect } from "vitest";
import git from "isomorphic-git";
import { create as createVFS } from "../fs/index.js";
import { createGitFsAdapter } from "./git-fs-adapter.js";

describe("git-fs-adapter against PieboxFS (Node backend)", () => {
  it("supports git.init + add + commit + log + status round-trip", async () => {
    const vfs = createVFS();
    const dir = "/repo";
    vfs.mkdirSync(dir, { recursive: true });
    const gitFs = createGitFsAdapter(vfs);

    await git.init({ fs: gitFs, dir, defaultBranch: "main" });

    vfs.writeFileSync(`${dir}/hello.txt`, "hello world\n");
    await git.add({ fs: gitFs, dir, filepath: "hello.txt" });

    const sha = await git.commit({
      fs: gitFs,
      dir,
      message: "initial",
      author: { name: "test", email: "test@example.com" },
    });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    const log = await git.log({ fs: gitFs, dir, depth: 1 });
    expect(log[0]?.commit.message).toBe("initial\n");

    vfs.writeFileSync(`${dir}/hello.txt`, "hello world!\n");
    const matrix = await git.statusMatrix({ fs: gitFs, dir });
    const modified = matrix.filter(([, head, work]) => head !== work);
    expect(modified.map(([p]) => p)).toEqual(["hello.txt"]);
  });
});
