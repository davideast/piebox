import { defineCommand } from "citty";
import { initServices } from "../services.js";
import { getName } from "../utils/naming.js";
import { output } from "../utils/output.js";

// ── Run ─────────────────────────────────────────────────────────────────────

const runArgs = {
  prompt: { type: "positional" as const, description: "Prompt for the agent", required: true },
  url: { type: "string" as const, description: "Git URL to clone" },
  dir: { type: "string" as const, description: "Local directory to seed into the sandbox" },
  sandbox: { type: "string" as const, alias: "s", description: "Sandbox name" },
  model: { type: "string" as const, alias: "m", description: "Model to use" },
  runtime: { type: "string" as const, alias: "r", description: "Runtime: 'node' enables QuickJS sandbox" },
  network: { type: "string" as const, alias: "n", description: "Allowed network origins (comma-separated)" },
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

  const networkOrigins = args.network !== undefined
    ? (args.network === "" ? [] : args.network.split(",").map((s: string) => s.trim()))
    : undefined;

  // --runtime node (explicit), --runtime false (opt-out), or undefined (use defaults)
  const runtime = args.runtime === "false" || args.runtime === false
    ? false as const
    : args.runtime === "node"
      ? "node" as const
      : undefined;

  const sandboxName = args.dir ? undefined : getName(args);
  const { run } = await initServices();

  const result = await run.execute({
    prompt: args.prompt,
    sandboxName,
    url: args.url,
    dir: args.dir,
    model: args.model,
    runtime,
    network: networkOrigins,
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

export const runCommand = defineCommand({
  meta: { name: "run", description: "Run a prompt in a sandbox" },
  args: runArgs,
  async run({ args }) {
    await executeRun(args);
  },
});
