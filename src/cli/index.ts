import { defineCommand, runMain } from "citty";
import { generateTripleName, generatePushId } from "./utils/naming.js";
import { formatOutput } from "./utils/output.js";

// ── Lazy loader ─────────────────────────────────────────────────────────────
// Heavy imports (SDK, VFS, isomorphic-git) only load when a command runs,
// not when --help is printed.

let _services: Awaited<ReturnType<typeof initServices>>;

async function initServices() {
  if (_services) return _services;

  const { SandboxManager } = await import("./sandbox-manager.js");
  const { CloneHandler } = await import("./services/clone/handler.js");
  const { CommitHandler } = await import("./services/commit/handler.js");
  const { ExportHandler } = await import("./services/export/handler.js");
  const { RunHandler } = await import("./services/run/handler.js");

  const manager = new SandboxManager();
  const clone = new CloneHandler(manager);
  const commit = new CommitHandler(manager);
  const exp = new ExportHandler(manager);
  const run = new RunHandler(clone, commit, exp, manager);

  _services = { manager, run, clone, commit, export: exp };
  return _services;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getName(args: Record<string, unknown>): string {
  if (typeof args.sandbox === "string" && args.sandbox.length > 0) return args.sandbox;
  return process.stdout.isTTY ? generateTripleName() : generatePushId();
}

function output(result: unknown, args: { json?: boolean }) {
  formatOutput(result, { json: args.json, tty: process.stdout.isTTY });
}

// ── Shared flags for run ────────────────────────────────────────────────────

const runArgs = {
  prompt: { type: "positional" as const, description: "Prompt for the agent", required: true },
  url: { type: "string" as const, description: "Git URL to clone" },
  dir: { type: "string" as const, description: "Local directory to seed into the sandbox" },
  sandbox: { type: "string" as const, alias: "s", description: "Sandbox name" },
  model: { type: "string" as const, alias: "m", description: "Model to use" },
  context: { type: "string" as const, alias: "c", description: "Context files/dirs to inject (comma-separated)" },
  continue: { type: "boolean" as const, description: "Overlay latest run output before prompting", default: false },
  from: { type: "string" as const, description: "Overlay a specific run's output (run ID or path)" },
  commit: { type: "boolean" as const, description: "Commit changes after prompt" },
  out: { type: "string" as const, description: "Export directory" },
  apply: { type: "boolean" as const, description: "Write changes directly to source dir", default: false },
  verbose: { type: "boolean" as const, alias: "v", description: "Stream agent narration to stdout", default: false },
  quiet: { type: "boolean" as const, alias: "q", description: "Suppress progress output", default: false },
  json: { type: "boolean" as const, description: "Machine-readable JSON output", default: false },
};

async function executeRun(args: Record<string, any>): Promise<void> {
  // Load .env for API keys
  try {
    const path = await import("node:path");
    const envDir = args.dir ? path.resolve(args.dir) : process.cwd();
    process.loadEnvFile(path.resolve(envDir, ".env"));
  } catch {
    // No .env — fine
  }

  const contextPaths = args.context
    ? args.context.split(",").map((s: string) => s.trim())
    : undefined;

  const sandboxName = args.dir ? undefined : getName(args);
  const { run } = await initServices();

  const result = await run.execute({
    prompt: args.prompt,
    sandboxName,
    url: args.url,
    dir: args.dir,
    model: args.model,
    context: contextPaths,
    continue: args.continue,
    from: args.from,
    commit: args.commit,
    outPath: args.out,
    apply: args.apply,
    verbose: args.verbose,
    quiet: args.quiet || args.json,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  }

  if (!result.success) {
    if (!args.json) {
      console.error(`\n❌ ${result.error.code}: ${result.error.message}`);
    }
    process.exitCode = 1;
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

const runCommand = defineCommand({
  meta: { name: "run", description: "Run a prompt in a sandbox" },
  args: runArgs,
  async run({ args }) {
    await executeRun(args);
  },
});

const cloneCommand = defineCommand({
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

const commitCommand = defineCommand({
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

const exportCommand = defineCommand({
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

const diffCommand = defineCommand({
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

const sandboxListCommand = defineCommand({
  meta: { name: "list", description: "List all sandboxes" },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    const { manager } = await initServices();
    output({ success: true, data: await manager.list() }, args);
  },
});

const sandboxDestroyCommand = defineCommand({
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

// ── Main ────────────────────────────────────────────────────────────────────

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
