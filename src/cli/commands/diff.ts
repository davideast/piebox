import { defineCommand } from "citty";
import { initServices } from "../services.js";
import { output } from "../utils/output.js";

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
