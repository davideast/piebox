/**
 * Standard piebox-native toolset built over a `Sandbox`.
 *
 * Wraps the existing operation factories (`createReadOperations`,
 * etc.) plus a `bash` tool that goes through `sandbox.runtime.run`.
 * Each tool is a thin shell — the real work still lives in
 * `src/operations/*.ts`.
 *
 * Step 3 of the composable-sandbox migration plan
 * (`docs/investigations/G-migration.md`). The toolset is what drivers
 * (agent loop, MCP server, CLI) consume. None of those drivers exist
 * yet; this file lands the contract.
 */

import {
  createReadOperations,
  createWriteOperations,
  createEditOperations,
  createLsOperations,
  createGrepOperations,
  createFindOperations,
} from "../operations/index.js";
import type { Sandbox } from "./sandbox.js";
import {
  createToolset,
  type PieboxResult,
  type PieboxTool,
  type PieboxToolset,
} from "./tool.js";

// ── Path resolution ──────────────────────────────────────────────────────
// Tools accept relative paths; the sandbox's cwd is the anchor.

function resolveInSandbox(sandbox: Sandbox, path: string): string {
  if (path.startsWith("/")) return path;
  const base = sandbox.cwd.endsWith("/")
    ? sandbox.cwd.slice(0, -1)
    : sandbox.cwd;
  return `${base}/${path}`;
}

// ── Result helpers ───────────────────────────────────────────────────────

function ok<T>(summary: string, data?: T): PieboxResult<T> {
  return data === undefined ? { ok: true, summary } : { ok: true, summary, data };
}

function fail<T = unknown>(summary: string, data?: T): PieboxResult<T> {
  return data === undefined ? { ok: false, summary } : { ok: false, summary, data };
}

// ── Tools ────────────────────────────────────────────────────────────────

interface ReadArgs {
  path: string;
}

const readTool: PieboxTool<ReadArgs, { content: string }> = {
  name: "read",
  description: "Read a file's UTF-8 contents from the sandbox.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or cwd-relative path." },
    },
    required: ["path"],
  },
  async execute(args, sandbox, signal) {
    if (signal.aborted) return fail("cancelled");
    const ops = createReadOperations(sandbox.fs);
    const abs = resolveInSandbox(sandbox, args.path);
    try {
      const buf = await ops.readFile(abs);
      const content = buf.toString("utf-8");
      return ok(`read ${args.path} (${content.length} bytes)`, { content });
    } catch (e) {
      return fail(`read failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface WriteArgs {
  path: string;
  content: string;
}

const writeTool: PieboxTool<WriteArgs> = {
  name: "write",
  description: "Create or overwrite a file with the given content.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  async execute(args, sandbox, signal) {
    if (signal.aborted) return fail("cancelled");
    const ops = createWriteOperations(sandbox.fs);
    const abs = resolveInSandbox(sandbox, args.path);
    const parent = abs.split("/").slice(0, -1).join("/") || "/";
    try {
      await ops.mkdir(parent);
      await ops.writeFile(abs, args.content);
      return ok(`wrote ${args.path} (${args.content.length} bytes)`);
    } catch (e) {
      return fail(`write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface EditArgs {
  path: string;
  oldText: string;
  newText: string;
}

const editTool: PieboxTool<EditArgs> = {
  name: "edit",
  description:
    "Replace exactly `oldText` with `newText` in `path`. `oldText` must appear exactly once.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
    },
    required: ["path", "oldText", "newText"],
  },
  async execute(args, sandbox, signal) {
    if (signal.aborted) return fail("cancelled");
    const ops = createEditOperations(sandbox.fs);
    const abs = resolveInSandbox(sandbox, args.path);
    try {
      const buf = await ops.readFile(abs);
      const cur = buf.toString("utf-8");
      const idx = cur.indexOf(args.oldText);
      if (idx < 0) return fail(`edit failed: oldText not found in ${args.path}`);
      if (cur.indexOf(args.oldText, idx + args.oldText.length) >= 0) {
        return fail(`edit failed: oldText appears more than once in ${args.path}`);
      }
      const next =
        cur.slice(0, idx) + args.newText + cur.slice(idx + args.oldText.length);
      await ops.writeFile(abs, next);
      return ok(`edited ${args.path}`);
    } catch (e) {
      return fail(`edit failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface LsArgs {
  path?: string;
}

const lsTool: PieboxTool<LsArgs, { entries: string[] }> = {
  name: "ls",
  description: "List directory entries.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
  },
  async execute(args, sandbox, signal) {
    if (signal.aborted) return fail("cancelled");
    const ops = createLsOperations(sandbox.fs);
    const target = args.path ?? sandbox.cwd;
    const abs = resolveInSandbox(sandbox, target);
    try {
      const entries = await ops.readdir(abs);
      return ok(`${entries.length} entries in ${target}`, { entries });
    } catch (e) {
      return fail(`ls failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface GrepArgs {
  pattern: string;
  path?: string;
}

const grepTool: PieboxTool<GrepArgs, { matches: string[] }> = {
  name: "grep",
  description: "Search for a regex pattern in files. Returns matching lines.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
    },
    required: ["pattern"],
  },
  async execute(args, sandbox, signal) {
    if (signal.aborted) return fail("cancelled");
    const ops = createGrepOperations(sandbox.fs);
    const target = args.path ?? sandbox.cwd;
    const abs = resolveInSandbox(sandbox, target);
    try {
      const isDir = await ops.isDirectory(abs);
      if (!isDir) {
        const content = await ops.readFile(abs);
        const re = new RegExp(args.pattern);
        const matches = content
          .split(/\r?\n/)
          .filter((line: string) => re.test(line));
        return ok(`${matches.length} match(es) in ${target}`, { matches });
      }
      return ok("grep: recursive scan not implemented in standard toolset", {
        matches: [],
      });
    } catch (e) {
      return fail(`grep failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface FindArgs {
  pattern: string;
  path?: string;
  limit?: number;
}

const findTool: PieboxTool<FindArgs, { paths: string[] }> = {
  name: "find",
  description: "Find files matching a glob pattern.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
      limit: { type: "number" },
    },
    required: ["pattern"],
  },
  async execute(args, sandbox, signal) {
    if (signal.aborted) return fail("cancelled");
    const ops = createFindOperations(sandbox.fs);
    const cwd = resolveInSandbox(sandbox, args.path ?? sandbox.cwd);
    try {
      const paths = await ops.glob(args.pattern, cwd, {
        ignore: [],
        limit: args.limit ?? 100,
      });
      return ok(`${paths.length} match(es)`, { paths });
    } catch (e) {
      return fail(`find failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface BashArgs {
  command: string;
  cwd?: string;
}

const bashTool: PieboxTool<BashArgs, { stdout: string; stderr: string }> = {
  name: "bash",
  description: "Run a shell command in the sandbox runtime.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string" },
    },
    required: ["command"],
  },
  async execute(args, sandbox, signal) {
    if (signal.aborted) {
      return { ok: false, summary: "cancelled", exitCode: undefined };
    }
    const cwd = args.cwd ? resolveInSandbox(sandbox, args.cwd) : sandbox.cwd;
    try {
      const r = await sandbox.runtime.run(args.command, { cwd, signal });
      return {
        ok: r.exitCode === 0,
        summary: `exit=${r.exitCode}`,
        data: { stdout: r.stdout, stderr: r.stderr },
        exitCode: r.exitCode,
      };
    } catch (e) {
      return fail(`bash failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
  async executeStreaming(args, sandbox, signal, onChunk) {
    if (signal.aborted) {
      return { ok: false, summary: "cancelled" };
    }
    const cwd = args.cwd ? resolveInSandbox(sandbox, args.cwd) : sandbox.cwd;
    try {
      const r = await sandbox.runtime.run(args.command, {
        cwd,
        signal,
        onStdout: (chunk: string) => onChunk(chunk, "stdout"),
        onStderr: (chunk: string) => onChunk(chunk, "stderr"),
      });
      return {
        ok: r.exitCode === 0,
        summary: `exit=${r.exitCode}`,
        data: { stdout: r.stdout, stderr: r.stderr },
        exitCode: r.exitCode,
      };
    } catch (e) {
      return fail(`bash failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Build the canonical piebox toolset over a sandbox. Drivers that
 * want a subset compose their own using `createToolset` from
 * `./tool.js`.
 */
export function createStandardToolset(_sandbox: Sandbox): PieboxToolset {
  // `_sandbox` is intentionally unused at construction — each tool
  // closes over the sandbox argument passed to `execute`, not the
  // one in scope here. The parameter stays so the call shape
  // matches the spec sketch in G-migration.md and so a future
  // toolset could vary by sandbox (e.g. omit tools the capabilities
  // don't support).
  return createToolset([
    readTool,
    writeTool,
    editTool,
    lsTool,
    grepTool,
    findTool,
    bashTool,
  ]);
}
