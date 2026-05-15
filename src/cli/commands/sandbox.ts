import { defineCommand } from "citty";
import { initServices } from "../services.js";
import { output } from "../utils/output.js";

// ── Sandbox List ────────────────────────────────────────────────────────────

export const sandboxListCommand = defineCommand({
  meta: { name: "list", description: "List all sandboxes" },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    const { manager } = await initServices();
    output({ success: true, data: await manager.list() }, args);
  },
});

// ── Sandbox Destroy ─────────────────────────────────────────────────────────

export const sandboxDestroyCommand = defineCommand({
  meta: { name: "destroy", description: "Destroy a sandbox" },
  args: {
    sandbox: { type: "positional", description: "Sandbox name", required: true },
    json: { type: "boolean" },
  },
  async run({ args }) {
    const { manager } = await initServices();
    await manager.destroy(args.sandbox);
    output({ success: true, data: { destroyed: args.sandbox } }, args);
  },
});
