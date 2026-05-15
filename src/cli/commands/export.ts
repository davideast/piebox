import { defineCommand } from "citty";
import { initServices } from "../services.js";
import { output } from "../utils/output.js";

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
