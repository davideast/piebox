/**
 * test-clone.ts — Verify in-memory git clone works end-to-end.
 */

import { cloneIntoSandbox } from "./src/index.js";

async function main() {
  console.log("Cloning into VFS...");
  try {
    const { vfs, dir, git } = await cloneIntoSandbox({
      url: "https://github.com/davideast/stitch-mcp",
      depth: 1,
      singleBranch: true,
      onProgress: (progress) => {
        if (progress.phase) {
          process.stdout.write(`\r  ${progress.phase} ${progress.loaded ?? ''}/${progress.total ?? ''}  `);
        }
      },
    });

    console.log("\n✅ Clone complete!");
    console.log("Dir:", dir);

    const files = vfs.readdirSync(dir);
    console.log("Top-level files:", files);

    const branch = await git.currentBranch();
    console.log("Branch:", branch);

    const log = await git.log(1);
    console.log("Latest commit:", log[0]?.commit?.message?.trim().slice(0, 80));

    const modified = await git.modifiedFiles();
    console.log("Modified:", modified.length === 0 ? "(clean)" : modified);

    // Simulate agent write
    vfs.writeFileSync(`${dir}/agent-output.txt`, "Agent wrote this.\n");
    const afterWrite = await git.modifiedFiles();
    console.log("After agent write:", afterWrite);

    console.log("\n✅ Full in-memory git workflow verified!");
  } catch (err: any) {
    console.error("ERROR:", err.message);
    console.error(err.stack);
  }
}

main();
