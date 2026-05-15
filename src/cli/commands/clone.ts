import { defineCommand } from "citty";
import { initServices } from "../services.js";
import { getName } from "../utils/naming.js";
import { output } from "../utils/output.js";

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
