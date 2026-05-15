import { defineCommand } from "citty";
import { initServices } from "../services.js";
import { output } from "../utils/output.js";

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
