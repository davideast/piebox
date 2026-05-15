import { defineCommand } from "citty";
import { initServices } from "../services.js";
import { getName } from "../utils/naming.js";
import { output } from "../utils/output.js";

// ── Clone ───────────────────────────────────────────────────────────────────

export const cloneCommand = defineCommand({
  meta: { name: "clone", description: "Clone a repo into a sandbox" },
  args: {
    url: { type: "positional", description: "Git URL", required: true },
    sandbox: { type: "string", alias: "s", description: "Sandbox name" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    const { clone } = await initServices();
    output(await clone.execute({ url: args.url, sandboxName: getName(args) }), args);
  },
});

// ── Commit ──────────────────────────────────────────────────────────────────

export const commitCommand = defineCommand({
  meta: { name: "commit", description: "Commit changes in the sandbox" },
  args: {
    sandbox: { type: "string", alias: "s", description: "Sandbox name", required: true },
    message: { type: "string", alias: "m", description: "Commit message" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    const { commit } = await initServices();
    output(await commit.execute({ sandboxName: args.sandbox, message: args.message }), args);
  },
});

// ── Export ───────────────────────────────────────────────────────────────────

export const exportCommand = defineCommand({
  meta: { name: "export", description: "Write sandbox files to disk" },
  args: {
    sandbox: { type: "string", alias: "s", description: "Sandbox name", required: true },
    out: { type: "string", description: "Output directory", required: true },
    json: { type: "boolean" },
  },
  async run({ args }) {
    const { export: exp } = await initServices();
    output(await exp.execute({ sandboxName: args.sandbox, outPath: args.out }), args);
  },
});

// ── Diff ────────────────────────────────────────────────────────────────────

export const diffCommand = defineCommand({
  meta: { name: "diff", description: "Show what changed" },
  args: {
    sandbox: { type: "string", alias: "s", description: "Sandbox name", required: true },
    json: { type: "boolean" },
  },
  async run({ args }) {
    try {
      const { manager } = await initServices();
      const sb = await manager.load(args.sandbox);
      if (!sb.git) throw new Error("Not a git repository");
      const files = await sb.git.modifiedFiles();
      output({ success: true, data: { files } }, args);
    } catch (e: unknown) {
      output({ success: false, error: { code: "DIFF_FAILED", message: (e instanceof Error ? e.message : String(e)) } }, args);
    }
  },
});
