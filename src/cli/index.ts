import { defineCommand, runMain } from "citty";
import { generateTripleName, generatePushId } from "./utils/naming.js";
import { formatOutput } from "./utils/output.js";

// ── Lazy loader ─────────────────────────────────────────────────────────────
// Heavy imports (SDK, VFS, isomorphic-git) only load when a command runs,
// not when --help is printed.

let _manager: any;
let _runHandler: any;
let _cloneHandler: any;
let _commitHandler: any;
let _exportHandler: any;

async function getManager() {
  if (!_manager) {
    const { SandboxManager } = await import("./sandbox-manager.js");
    _manager = new SandboxManager();
  }
  return _manager;
}

async function getRunHandler() {
  if (!_runHandler) {
    const manager = await getManager();
    const { CloneHandler } = await import("./services/clone/handler.js");
    const { CommitHandler } = await import("./services/commit/handler.js");
    const { ExportHandler } = await import("./services/export/handler.js");
    const { RunHandler } = await import("./services/run/handler.js");
    _cloneHandler = new CloneHandler(manager);
    _commitHandler = new CommitHandler(manager);
    _exportHandler = new ExportHandler(manager);
    _runHandler = new RunHandler(_cloneHandler, _commitHandler, _exportHandler, manager);
  }
  return _runHandler;
}

async function getCloneHandler() {
  if (!_cloneHandler) await getRunHandler(); // initializes all handlers
  return _cloneHandler;
}

async function getCommitHandler() {
  if (!_commitHandler) await getRunHandler();
  return _commitHandler;
}

async function getExportHandler() {
  if (!_exportHandler) await getRunHandler();
  return _exportHandler;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getName(args: Record<string, unknown>): string {
  if (typeof args.sandbox === "string" && args.sandbox.length > 0) return args.sandbox;
  return process.stdout.isTTY ? generateTripleName() : generatePushId();
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
  const runHandler = await getRunHandler();

  const result = await runHandler.execute({
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
    json: { type: "boolean" }
  },
  async run({ args }) {
    const sandboxName = getName(args);
    const cloneHandler = await getCloneHandler();
    const result = await cloneHandler.execute({ url: args.url, sandboxName });
    formatOutput(result, { json: args.json, tty: process.stdout.isTTY });
  }
});

const commitCommand = defineCommand({
  meta: { name: "commit", description: "Commit changes in the sandbox" },
  args: {
    sandbox: { type: "string", alias: "s", description: "Sandbox name", required: true },
    message: { type: "string", alias: "m", description: "Commit message" },
    json: { type: "boolean" }
  },
  async run({ args }) {
    const commitHandler = await getCommitHandler();
    const result = await commitHandler.execute({ sandboxName: args.sandbox, message: args.message });
    formatOutput(result, { json: args.json, tty: process.stdout.isTTY });
  }
});

const exportCommand = defineCommand({
  meta: { name: "export", description: "Write sandbox files to disk" },
  args: {
    sandbox: { type: "string", alias: "s", description: "Sandbox name", required: true },
    out: { type: "string", description: "Output directory", required: true },
    json: { type: "boolean" }
  },
  async run({ args }) {
    const exportHandler = await getExportHandler();
    const result = await exportHandler.execute({ sandboxName: args.sandbox, outPath: args.out });
    formatOutput(result, { json: args.json, tty: process.stdout.isTTY });
  }
});

const diffCommand = defineCommand({
  meta: { name: "diff", description: "Show what changed" },
  args: {
    sandbox: { type: "string", alias: "s", description: "Sandbox name", required: true },
    json: { type: "boolean" }
  },
  async run({ args }) {
    try {
      const manager = await getManager();
      const sb = await manager.load(args.sandbox);
      if (!sb.git) throw new Error("Not a git repository");
      const files = await sb.git.modifiedFiles();
      formatOutput({ success: true, data: { files } }, { json: args.json, tty: process.stdout.isTTY });
    } catch (e: unknown) {
      formatOutput({ success: false, error: { code: "DIFF_FAILED", message: (e instanceof Error ? e.message : String(e)) } }, { json: args.json, tty: process.stdout.isTTY });
    }
  }
});

const sandboxListCommand = defineCommand({
  meta: { name: "list", description: "List all sandboxes" },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    const manager = await getManager();
    const list = await manager.list();
    formatOutput({ success: true, data: list }, { json: args.json, tty: process.stdout.isTTY });
  }
});

const sandboxDestroyCommand = defineCommand({
  meta: { name: "destroy", description: "Destroy a sandbox" },
  args: {
    sandbox: { type: "positional", description: "Sandbox name", required: true },
    json: { type: "boolean" }
  },
  async run({ args }) {
    const manager = await getManager();
    await manager.destroy(args.sandbox);
    formatOutput({ success: true, data: { destroyed: args.sandbox } }, { json: args.json, tty: process.stdout.isTTY });
  }
});

// ── Main ────────────────────────────────────────────────────────────────────

const mainCommand = defineCommand({
  meta: {
    name: "piebox",
    version: "0.1.0",
    description: "Piebox CLI - Lightweight in-memory sandbox environment"
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
        destroy: sandboxDestroyCommand
      }
    })
  },
});

export function runCli() {
  runMain(mainCommand);
}
