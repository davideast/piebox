import { defineCommand, runMain } from "citty";
import { createRequire } from "node:module";
import { runCommand } from "./commands/run.js";
import { cloneCommand } from "./commands/clone.js";
import { commitCommand } from "./commands/commit.js";
import { exportCommand } from "./commands/export.js";
import { diffCommand } from "./commands/diff.js";
import { filesCommand, readCommand } from "./commands/inspect.js";
import { sandboxListCommand, sandboxDestroyCommand } from "./commands/sandbox.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

const mainCommand = defineCommand({
  meta: {
    name: "piebox",
    version,
    description: "Piebox CLI - Lightweight in-memory sandbox environment",
  },
  subCommands: {
    run: runCommand,
    clone: cloneCommand,
    commit: commitCommand,
    export: exportCommand,
    diff: diffCommand,
    files: filesCommand,
    read: readCommand,
    sandbox: defineCommand({
      meta: { name: "sandbox", description: "Manage sandboxes" },
      subCommands: {
        list: sandboxListCommand,
        destroy: sandboxDestroyCommand,
      },
    }),
  },
});

export function runCli() {
  runMain(mainCommand);
}

