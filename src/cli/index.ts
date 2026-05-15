import { defineCommand, runMain } from "citty";
import { runCommand } from "./commands/run.js";
import { cloneCommand, commitCommand, exportCommand, diffCommand } from "./commands/repo.js";
import { sandboxListCommand, sandboxDestroyCommand } from "./commands/sandbox.js";

const mainCommand = defineCommand({
  meta: {
    name: "piebox",
    version: "0.1.0",
    description: "Piebox CLI - Lightweight in-memory sandbox environment",
  },
  subCommands: {
    run: runCommand,
    clone: cloneCommand,
    commit: commitCommand,
    export: exportCommand,
    diff: diffCommand,
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
