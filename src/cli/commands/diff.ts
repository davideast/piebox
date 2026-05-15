import { defineCommand } from "citty";
import { initServices } from "../services.js";
import { output } from "../utils/output.js";
import type { SandboxInstance } from "../../sandbox.js";

interface FileDiff {
  file: string;
  original: string;
  current: string;
  isNew: boolean;
  isDeleted: boolean;
}

export const diffCommand = defineCommand({
  meta: { name: "diff", description: "Show what the agent changed in a sandbox" },
  args: {
    sandbox: { type: "string", alias: "s", description: "Sandbox name", required: true },
    file: { type: "string", alias: "f", description: "Show diff for a specific file" },
    stat: { type: "boolean", description: "Show file-level summary only (like git diff --stat)" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    try {
      const { manager } = await initServices();
      const sb = await manager.load(args.sandbox);
      if (!sb.git) throw new Error("Not a git repository. Clone with: piebox clone <url> -s " + args.sandbox);

      const files = await sb.git.modifiedFiles();

      if (files.length === 0) {
        if (args.json) {
          output({ success: true, data: { files: [], summary: "No changes" } }, args);
        } else {
          console.log("No changes detected.");
        }
        return;
      }

      // --stat mode: just list files
      if (args.stat) {
        if (args.json) {
          output({ success: true, data: { files } }, args);
        } else {
          console.log(`${files.length} file${files.length === 1 ? "" : "s"} changed:\n`);
          for (const f of files) {
            console.log(`  M ${f}`);
          }
        }
        return;
      }

      // Filter to specific file
      const targetFiles = args.file ? files.filter((f: string) => f === args.file || f.endsWith(args.file!)) : files;

      if (args.file && targetFiles.length === 0) {
        throw new Error(`File '${args.file}' not found in modified files. Modified: ${files.join(", ")}`);
      }

      // Collect file diffs
      const diffs: FileDiff[] = [];
      for (const filepath of targetFiles) {
        diffs.push(await getFileDiff(sb, filepath));
      }

      if (args.json) {
        // JSON mode: use `diff` library for standard unified diff strings
        const { createPatch } = await import("diff");
        const jsonDiffs = diffs.map((d) => ({
          file: d.file,
          diff: d.isDeleted
            ? "(file deleted)"
            : createPatch(d.file, d.original, d.current, "HEAD", "working", { context: 3 }),
        }));
        output({ success: true, data: { files: targetFiles, diffs: jsonDiffs } }, args);
      } else {
        // TTY mode: use niftty for beautiful syntax-highlighted diffs
        const { niftty } = await import("niftty");

        for (const d of diffs) {
          console.log(`\n  ${d.file}${d.isNew ? " (new)" : d.isDeleted ? " (deleted)" : ""}`);
          console.log("─".repeat(60));

          if (d.isDeleted) {
            console.log("  (file deleted)");
            continue;
          }

          const rendered = await niftty({
            code: d.current,
            diffWith: d.original,
            filePath: d.file,
            theme: "github-dark",
            collapseUnchanged: true,
            lineNumbers: "both",
          });

          process.stdout.write(rendered);
          console.log();
        }

        console.log(`\n${diffs.length} file${diffs.length === 1 ? "" : "s"} with changes`);
      }
    } catch (e: unknown) {
      output({ success: false, error: { code: "DIFF_FAILED", message: (e instanceof Error ? e.message : String(e)) } }, args);
    }
  },
});

/**
 * Get the original and current content for a file in the sandbox.
 * Original = committed at HEAD. Current = in-memory VFS.
 */
async function getFileDiff(sb: SandboxInstance, filepath: string): Promise<FileDiff> {
  const fullPath = filepath.startsWith("/") ? filepath : `${sb.cwd}/${filepath}`;

  // Read current VFS content
  let current: string;
  let isDeleted = false;
  try {
    current = sb.fs.readFileSync(fullPath, "utf-8") as string;
  } catch {
    current = "";
    isDeleted = true;
  }

  // Read committed content from git HEAD
  let original = "";
  let isNew = false;
  try {
    if (sb.git) {
      const git = await import("isomorphic-git");
      const { createGitFsAdapter } = await import("../../adapters/git-fs-adapter.js");
      const gitFs = createGitFsAdapter(sb.fs);
      const dir = sb.cwd;

      const oid = await git.resolveRef({ fs: gitFs, dir, ref: "HEAD" });
      const { blob } = await git.readBlob({
        fs: gitFs,
        dir,
        oid,
        filepath: filepath.startsWith("/") ? filepath.slice(sb.cwd.length + 1) : filepath,
      });
      original = new TextDecoder().decode(blob);
    }
  } catch {
    // New file — no original at HEAD
    isNew = true;
  }

  return { file: filepath, original, current, isNew, isDeleted };
}
