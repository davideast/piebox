/**
 * In-browser agent session, built on:
 *   • @piebox/driver-agent    — the agent loop driver (ReAct over Layer 2)
 *   • @inbrowser/relay        — Gemini SSE provider (via the driver's
 *                               inbrowser-agent adapter; called directly,
 *                               no relay server)
 *   • piebox/browser          — PieboxFS + PieboxRuntime
 *   • piebox/layer2           — Sandbox + PieboxTool + capabilities
 *
 * Pre-Step-4 this file owned both the agent-loop wiring (via
 * `@inbrowser/agent`'s `createAgentSession`) and the 11 ToolHandler
 * definitions. The wiring half now lives in `@piebox/driver-agent`;
 * what remains here is:
 *
 *   • A minimal `Sandbox` factory that wraps the playground's PieboxFS
 *     + PieboxRuntime + `BROWSER_CAPABILITIES`. We don't go through
 *     `createSandbox` from `piebox/layer2` because that pulls
 *     `node:zlib` (via the tarball implementation) which we don't need
 *     in the browser. A future browser entry surface will expose this
 *     factory; until then the playground keeps it inline.
 *
 *   • 11 PieboxTool definitions (write/read/edit/bash/ls + 7 git tools)
 *     using the Layer 2 `(args, sandbox, signal) => PieboxResult` shape.
 *
 *   • The playground-specific system-prompt addendum (almostnode quirks
 *     — npm devDeps backstop, node -e translation, no `npx`, etc.). The
 *     driver's `defaultSystemPromptBuilder` writes the generic
 *     capability-templated part; this file appends the substrate notes.
 */

import {
  createAgentDriver,
  createGeminiLlmClient,
  defaultSystemPromptBuilder,
  type AgentDriver,
  type AgentEvent,
} from "@piebox/driver-agent";
import {
  createToolset,
  BROWSER_CAPABILITIES,
  type PieboxResult,
  type PieboxTool,
  type PieboxToolset,
  type RuntimeCapabilities,
  type Sandbox,
} from "piebox/layer2";
import type { PieboxFS, PieboxRuntime } from "piebox/browser";
import { runInSandbox } from "./runtime/translators.js";
import {
  gitInit,
  gitStatus,
  gitAdd,
  gitAddAll,
  gitCommit,
  gitLog,
  gitBranch,
  gitListBranches,
  gitCurrentBranch,
} from "./git.js";

const KEY_STORAGE = "piebox-playground:google-api-key";

export function getStoredApiKey(): string | null {
  try { return localStorage.getItem(KEY_STORAGE); } catch { return null; }
}
export function storeApiKey(key: string): void {
  try { localStorage.setItem(KEY_STORAGE, key); } catch { /* no-op */ }
}
export function clearApiKey(): void {
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* no-op */ }
}

// ── AgentEvent re-export (for useAgentLoop's switch) ──────────────────────

export type { AgentEvent };

// ── Browser-flavored Sandbox factory ──────────────────────────────────────
// Wraps PieboxFS + PieboxRuntime in the Layer 2 Sandbox shape. We hand-roll
// the literal instead of calling `createSandbox` from `piebox/layer2`
// because that path drags in `node:zlib` via tarball.ts. The playground
// never calls toTarball/toGitPack/applyPatch from the browser; those
// methods throw "not implemented" here so a stray call is loud.

interface BrowserSandboxInit {
  fs: PieboxFS;
  runtime: PieboxRuntime;
  cwd: string;
  capabilities?: RuntimeCapabilities;
  id?: string;
}

let sandboxCounter = 0;

function createBrowserSandbox(init: BrowserSandboxInit): Sandbox {
  const id = init.id ?? `sb-browser-${++sandboxCounter}-${Date.now().toString(36)}`;
  const capabilities = init.capabilities ?? BROWSER_CAPABILITIES;
  const handlers = new Set<() => void>();
  let destroyed = false;

  return {
    id,
    fs: init.fs,
    runtime: init.runtime,
    cwd: init.cwd,
    capabilities,
    async toTarball() {
      throw new Error("Sandbox.toTarball is not available in the browser playground.");
    },
    async toGitPack() {
      throw new Error("Sandbox.toGitPack is not implemented.");
    },
    async applyPatch() {
      throw new Error("Sandbox.applyPatch is not implemented.");
    },
    on(event, handler) {
      if (event !== "destroyed") return { dispose: () => undefined };
      handlers.add(handler);
      return { dispose: () => { handlers.delete(handler); } };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const snapshot = Array.from(handlers);
      handlers.clear();
      for (const h of snapshot) {
        try { h(); } catch { /* swallow */ }
      }
    },
  };
}

// ── PieboxTool definitions ────────────────────────────────────────────────
// Eleven tools: write/read/edit/bash/ls plus 7 git_* tools. All use the
// Layer 2 `(args, sandbox, signal) => PieboxResult` shape. `bash` also
// implements `executeStreaming` so the Shell tab can subscribe to live
// chunks; the agent driver currently uses the buffered `execute` path
// (live stdout forwarding into AgentEvent is a Layer 2 gap — C.1 §"gaps"
// #1).

function resolvePath(cwd: string, p: string): string {
  if (p.startsWith("/")) return p;
  if (cwd.endsWith("/")) return cwd + p;
  return `${cwd}/${p}`;
}

function ok<T>(summary: string, data?: T): PieboxResult<T> {
  return data === undefined ? { ok: true, summary } : { ok: true, summary, data };
}

function fail<T = unknown>(summary: string, data?: T): PieboxResult<T> {
  return data === undefined ? { ok: false, summary } : { ok: false, summary, data };
}

function buildBrowserTools(fs: PieboxFS, runtime: PieboxRuntime, cwd: string): readonly PieboxTool[] {
  const writeTool: PieboxTool<{ path: string; content: string }> = {
    name: "write",
    description: "Create or overwrite a file with the given content. Use for new files.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or cwd-relative path." },
        content: { type: "string", description: "Full UTF-8 content for the file." },
      },
      required: ["path", "content"],
    },
    async execute(args, _sandbox, signal) {
      if (signal.aborted) return fail("cancelled");
      const resolved = resolvePath(cwd, args.path);
      const parent = resolved.split("/").slice(0, -1).join("/") || "/";
      try {
        fs.mkdirSync(parent, { recursive: true });
        fs.writeFileSync(resolved, args.content);
        return ok(`wrote ${resolved} (${args.content.length} bytes)`);
      } catch (e) {
        return fail(`write failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const readTool: PieboxTool<{ path: string }, { content: string }> = {
    name: "read",
    description: "Read a file's UTF-8 contents.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    async execute(args, _sandbox, signal) {
      if (signal.aborted) return fail("cancelled");
      try {
        const text = fs.readFileSync(resolvePath(cwd, args.path), "utf-8") as string;
        return ok(`read ${args.path} (${text.length} bytes)`, { content: text });
      } catch (e) {
        return fail(`read failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const editTool: PieboxTool<{ path: string; oldText: string; newText: string }> = {
    name: "edit",
    description: "Replace exactly `oldText` with `newText` in `path`. `oldText` must appear once.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
    },
    async execute(args, _sandbox, signal) {
      if (signal.aborted) return fail("cancelled");
      const resolved = resolvePath(cwd, args.path);
      try {
        const cur = fs.readFileSync(resolved, "utf-8") as string;
        const idx = cur.indexOf(args.oldText);
        if (idx < 0) return fail(`edit failed: oldText not found in ${args.path}`);
        if (cur.indexOf(args.oldText, idx + args.oldText.length) >= 0) {
          return fail(`edit failed: oldText appears more than once in ${args.path}`);
        }
        const next = cur.slice(0, idx) + args.newText + cur.slice(idx + args.oldText.length);
        fs.writeFileSync(resolved, next);
        return ok(`edited ${args.path}`);
      } catch (e) {
        return fail(`edit failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  // Bash tool — buffered `execute` (used by the agent driver today)
  // plus `executeStreaming` (used when the Shell tab forwards live
  // output). Both go through the shared `runInSandbox` translator
  // pipeline so the agent and the user see identical [piebox] notice
  // lines and translations.
  const bashTool: PieboxTool<{ command: string; cwd?: string }, {
    stdout: string;
    stderr: string;
    exitCode: number;
  }> = {
    name: "bash",
    description:
      "Run a shell command in the in-browser sandbox. `node` and `npm` work. " +
      "`npm create <name>` and `npm init <name>` are translated by piebox to install + run-bin. " +
      "`git <subcommand>` is routed to isomorphic-git for init/status/add/commit/log/branch/checkout. " +
      "See [piebox] notice lines in the output for any translations applied.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["command"],
    },
    async execute(args, _sandbox, signal) {
      if (signal.aborted) return { ok: false, summary: "cancelled" };
      const workCwd = args.cwd ? resolvePath(cwd, args.cwd) : cwd;
      try {
        const r = await runInSandbox(args.command, { fs, runtime, cwd: workCwd, signal });
        return {
          ok: r.exitCode === 0,
          summary: `exit=${r.exitCode}`,
          data: r,
          exitCode: r.exitCode,
        };
      } catch (e) {
        return fail(`bash failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    async executeStreaming(args, _sandbox, signal, onChunk) {
      if (signal.aborted) return { ok: false, summary: "cancelled" };
      const workCwd = args.cwd ? resolvePath(cwd, args.cwd) : cwd;
      try {
        const r = await runInSandbox(args.command, {
          fs,
          runtime,
          cwd: workCwd,
          signal,
          onStdout: (chunk) => onChunk(chunk, "stdout"),
          onStderr: (chunk) => onChunk(chunk, "stderr"),
        });
        return {
          ok: r.exitCode === 0,
          summary: `exit=${r.exitCode}`,
          data: r,
          exitCode: r.exitCode,
        };
      } catch (e) {
        return fail(`bash failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const lsTool: PieboxTool<{ path: string }, { entries: string[] }> = {
    name: "ls",
    description: "List directory entries.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    async execute(args, _sandbox, signal) {
      if (signal.aborted) return fail("cancelled");
      const resolved = resolvePath(cwd, args.path);
      try {
        const dirents = fs.readdirSync(resolved, { withFileTypes: true });
        const lines = dirents.map((d) => (d.isDirectory() ? `${d.name}/` : d.name));
        return ok(`${lines.length} entries in ${args.path}`, { entries: lines });
      } catch (e) {
        return fail(`ls failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  // ── git tools (backed by isomorphic-git over the same PieboxFS) ─────
  const gitCtx = { fs, dir: cwd };

  const gitInitTool: PieboxTool<{ defaultBranch?: string }> = {
    name: "git_init",
    description: "Initialize a git repo at the cwd. Optionally set the default branch (defaults to 'main').",
    inputSchema: {
      type: "object",
      properties: { defaultBranch: { type: "string" } },
    },
    async execute(args, _sandbox, signal) {
      if (signal.aborted) return fail("cancelled");
      const defaultBranch = args.defaultBranch ?? "main";
      try {
        await gitInit(gitCtx, defaultBranch);
        return ok(`initialized git repo at ${cwd} (default branch: ${defaultBranch})`);
      } catch (e) {
        return fail(`git_init failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const gitStatusTool: PieboxTool<Record<string, never>, { changes: Array<{ path: string; status: string }> }> = {
    name: "git_status",
    description: "List files that differ between HEAD, the index, and the working directory.",
    inputSchema: { type: "object", properties: {} },
    async execute(_args, _sandbox, signal) {
      if (signal.aborted) return fail("cancelled");
      try {
        const changes = await gitStatus(gitCtx);
        if (changes.length === 0) return ok("clean — no changes", { changes: [] });
        const summary = `${changes.length} changed: ${changes.map((c) => `${c.status} ${c.path}`).join(", ")}`;
        return ok(summary, { changes });
      } catch (e) {
        return fail(`git_status failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const gitAddTool: PieboxTool<{ filepath?: string; all?: boolean }> = {
    name: "git_add",
    description: "Stage a file. Pass `filepath` (cwd-relative) for a single file, or set `all: true` to stage everything that differs.",
    inputSchema: {
      type: "object",
      properties: {
        filepath: { type: "string", description: "cwd-relative file path" },
        all: { type: "boolean", description: "Stage all modified/new files" },
      },
    },
    async execute(args, _sandbox, signal) {
      if (signal.aborted) return fail("cancelled");
      try {
        if (args.all) {
          const touched = await gitAddAll(gitCtx);
          return ok(`staged ${touched.length} file(s)`, { staged: touched });
        }
        if (!args.filepath) return fail("git_add needs `filepath` or `all: true`");
        const rel = args.filepath.startsWith(cwd + "/")
          ? args.filepath.slice(cwd.length + 1)
          : args.filepath;
        await gitAdd(gitCtx, rel);
        return ok(`staged ${rel}`);
      } catch (e) {
        return fail(`git_add failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const gitCommitTool: PieboxTool<{ message: string; author?: { name: string; email: string } }, { sha: string }> = {
    name: "git_commit",
    description: "Commit staged changes. Provide `message` (required); optionally `author.name` and `author.email`.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        author: {
          type: "object",
          properties: { name: { type: "string" }, email: { type: "string" } },
        },
      },
      required: ["message"],
    },
    async execute(args, _sandbox, signal) {
      if (signal.aborted) return fail("cancelled");
      try {
        const sha = await gitCommit(gitCtx, args.message, args.author);
        return ok(`committed ${sha.slice(0, 8)}: ${args.message}`, { sha });
      } catch (e) {
        return fail(`git_commit failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const gitLogTool: PieboxTool<{ depth?: number }, { commits: Array<{ oid: string; message: string; author: string }> }> = {
    name: "git_log",
    description: "Return the most recent commits (default depth 10).",
    inputSchema: {
      type: "object",
      properties: { depth: { type: "number" } },
    },
    async execute(args, _sandbox, signal) {
      if (signal.aborted) return fail("cancelled");
      try {
        const entries = await gitLog(gitCtx, args.depth ?? 10);
        const summary = entries.length === 0
          ? "no commits yet"
          : `${entries.length} commit(s): ${entries.map((e) => `${e.oid.slice(0, 7)} ${e.message}`).join(" | ")}`;
        return ok(summary, { commits: entries });
      } catch (e) {
        return fail(`git_log failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const gitBranchTool: PieboxTool<{ name?: string; checkout?: boolean; current?: boolean }> = {
    name: "git_branch",
    description: "Branch operations. Pass `name` to create (and `checkout: true` to switch). Pass nothing to list branches. Pass `current: true` to report the current branch.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        checkout: { type: "boolean" },
        current: { type: "boolean" },
      },
    },
    async execute(args, _sandbox, signal) {
      if (signal.aborted) return fail("cancelled");
      try {
        if (args.current) {
          const b = await gitCurrentBranch(gitCtx);
          return ok(`current branch: ${b ?? "(detached)"}`, { branch: b });
        }
        if (!args.name) {
          const list = await gitListBranches(gitCtx);
          return ok(`${list.length} branch(es): ${list.join(", ")}`, { branches: list });
        }
        await gitBranch(gitCtx, args.name, args.checkout ?? false);
        return ok(`created branch ${args.name}${args.checkout ? " (checked out)" : ""}`);
      } catch (e) {
        return fail(`git_branch failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  return [
    writeTool, readTool, editTool, bashTool, lsTool,
    gitInitTool, gitStatusTool, gitAddTool, gitCommitTool, gitLogTool, gitBranchTool,
  ];
}

// ── System prompt: capability template + browser-specific addendum ────────
// The driver's `defaultSystemPromptBuilder` handles the generic per-
// capability prose (vfs vs os, shim vs real process model, available
// binaries, etc.). The playground appends substrate-specific notes
// almostnode users need but the driver shouldn't ship: which npm
// translations apply, what `bash` does and doesn't have, the
// devDependencies-vs-dependencies trap, dev-server invocation rules,
// and the strict verification protocol.

const BROWSER_PROMPT_ADDENDUM = [
  "## Substrate: almostnode (in-browser Node.js)",
  "The cwd is /work. All paths are inside the in-memory virtual filesystem.",
  "",
  "## Tools",
  "### Filesystem",
  "- write(path, content): create/overwrite a file",
  "- read(path): read a file",
  "- edit(path, oldText, newText): single-occurrence string replace",
  "- ls(path): list a directory",
  "- bash(command): run a shell command in the sandbox",
  "### Git (powered by isomorphic-git, in-memory)",
  "- git_init({ defaultBranch? }): init a repo at the cwd",
  "- git_status(): list changed paths",
  "- git_add({ filepath }) or git_add({ all: true }): stage",
  "- git_commit({ message, author? }): commit staged changes",
  "- git_log({ depth? }): recent commits",
  "- git_branch({ name?, checkout?, current? }): create/list/report branches",
  "",
  "Use the git_* tools for ALL git operations. The `bash` shell does NOT have a `git` binary.",
  "",
  "## What `bash` can run",
  "- `node <file>` — runs JS, .mjs, AND .ts/.tsx directly (almostnode's node shim transforms TS via esbuild-wasm). Do NOT install ts-node or typescript or tsc.",
  "- TS-to-TS imports: when one .ts file imports another, the importer's TS is transformed but the import path resolver may NOT transform the importee. Safest: write the file you're going to import as plain JavaScript (.js or .mjs), or import with no extension (`import { x } from './fib'`) and hope the resolver tries .ts. If you see 'Unexpected token \":\"' on the imported file, rewrite it as .js.",
  "- `node -e '<code>'` / `node --eval '<code>'` — translated by piebox: writes the code to a tempfile, runs `node <tmp>`, deletes the tempfile. You'll see `[piebox]` lines in the output. (almostnode's node shim doesn't parse flags directly; tracked as almostnode#18.)",
  "- `npm install <pkg>` (alias `npm i`, `npm add`) — real registry install into /work/node_modules.",
  "- `npm install` (no args) — install from package.json.",
  "- `npm run <script>`, `npm start`, `npm test`, `npm ls`.",
  "- `npm create <name>[@version] [args]` and `npm init <name>[@version] [args]` — translated by piebox to `npm install create-<name>@<version>` + `node ./node_modules/create-<name>/<bin> <args>`. Same algorithm as real npm, MINUS: TTY (so interactive prompts fail; pass --template / --yes / --ts flags), INIT_CWD, and other npm_* env vars. The translation is printed in the bash output with `[piebox]` lines so you can see exactly what ran. Use the canonical syntax — `npm create vite@latest . -- --template react-ts`, `npm create next-app@latest my-app -- --ts --use-npm`, etc.",
  "",
  "## CRITICAL: write package.json with everything in `dependencies`",
  "almostnode's `npm install` (no args) only installs `dependencies` from package.json — it silently SKIPS `devDependencies`. This is tracked as piebox#2.",
  "If you write a package.json with `\"vite\"` in `devDependencies` and run `npm install`, vite WILL NOT be installed and `node ./node_modules/vite/bin/vite.js` will fail with 'Cannot find module'.",
  "Workaround: put EVERYTHING (build tools, type packages, the framework itself, runtime libraries) into `dependencies`. Yes, even `vite`, `typescript`, `@vitejs/plugin-react`, `@types/react`. Treat `devDependencies` as if it doesn't exist for sandbox projects.",
  "Example for a Vite + React + TS project:",
  "```json",
  "{",
  "  \"name\": \"my-app\", \"private\": true, \"type\": \"module\",",
  "  \"scripts\": { \"dev\": \"vite\", \"build\": \"vite build\" },",
  "  \"dependencies\": {",
  "    \"react\": \"^18.3.1\", \"react-dom\": \"^18.3.1\",",
  "    \"vite\": \"^5.4.8\", \"@vitejs/plugin-react\": \"^4.3.2\",",
  "    \"typescript\": \"^5.6.2\", \"@types/react\": \"^18.3.10\", \"@types/react-dom\": \"^18.3.0\"",
  "  }",
  "}",
  "```",
  "After writing package.json, run `npm install` once, then verify `node_modules/vite/` exists with `ls('node_modules')` before trying to run the dev server.",
  "",
  "## Verifying code (READ THIS)",
  "`node --test <file>` is NOT supported — almostnode's node shim treats `--test` as the script path and fails with 'Cannot find module'. There is no built-in test runner flag.",
  "To verify code, write a small script that imports your module and asserts. Example:",
  "  // verify.ts",
  "  import { fib } from './fib.ts';",
  "  import assert from 'node:assert';",
  "  assert.strictEqual(fib(10), 55);",
  "  console.log('ok');",
  "Then run `node verify.ts`. Exit code 0 + 'ok' on stdout = passed. AssertionError = failed.",
  "If you need a real test framework, `npm install vitest` works; then `npx`-style invocations fail (no npx), so call the binary directly: `node node_modules/vitest/vitest.mjs run`.",
  "",
  "## Dev-server invocation: do NOT pass --host",
  "When starting a framework dev server (e.g. `node ./node_modules/vite/bin/vite.js`), DO NOT pass `--host` or `--host 0.0.0.0`. Vite 5.4+ enables an `allowedHosts` check when binding to all interfaces, and the playground's Service Worker bridge forwards requests with no Host header — Vite then 403s the bridged request.",
  "Bind to localhost (the default — pass NO --host flag). The bridge handles cross-origin exposure for the preview iframe.",
  "If you must pass a port, use `--port <N>` alone, e.g. `node ./node_modules/vite/bin/vite.js --port 3000`.",
  "If you're authoring `vite.config.ts`, include `server: { allowedHosts: true }` as belt-and-suspenders.",
  "",
  "## When `npm run <script>` fails with 'command not found'",
  "package.json scripts often chain binaries that are not on PATH in this sandbox. The common offender is `\"build\": \"tsc && vite build\"` — `tsc` isn't shipped, and you don't need it because `node` handles TypeScript natively.",
  "If you see a 'command not found' for a tool in a script:",
  "  1. Drop the unnecessary step (tsc is almost always unnecessary here).",
  "  2. Invoke the installed binary directly via its node_modules path. e.g. instead of `npm run build`, try `node ./node_modules/vite/bin/vite.js build` (the path comes from the package's `bin` field — look it up with `read('node_modules/<pkg>/package.json')`).",
  "  3. If a tool genuinely cannot run (no source-available alternative), STOP and report. Do not declare a build successful when it errored.",
  "",
  "## When a scaffolder fails (substrate gap → manual fallback)",
  "`npm create vite` / `npm create next-app` / `create-*` packages can fail because the scaffolder uses a Node API almostnode hasn't shimmed yet (e.g. `util.styleText`, `node:test`). When that happens, the `[piebox]` translation header in the output tells you the install part succeeded — but the `node ./node_modules/create-*/bin` step failed.",
  "DO NOT fall back to just writing component files. That leaves the project unbuildable. The scaffolder normally does THREE things you must reproduce:",
  "  1. write `package.json` with the framework's RUNTIME deps (e.g. `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `typescript`)",
  "  2. write `tsconfig.json`, `vite.config.ts` (or framework equivalent), `index.html`, `src/main.tsx`",
  "  3. write `src/App.tsx` and any styles",
  "Then `npm install` (no args, picks up the package.json deps), THEN run the framework: `node ./node_modules/vite/bin/vite.js`. Without step 1 + the install, step 3's component files are unbuildable orphans.",
  "If you skip the install, do NOT claim 'the dev server is running' — `node ./node_modules/vite/...` will fail with 'Cannot find module'.",
  "",
  "## What `bash` does NOT have",
  "- `npx`, `git` (use git_* tools instead), `curl`, `wget`, `python`, `make`, or any other binary.",
  "- `npm uninstall`, `npm version`, `npm outdated`, `npm audit`, `npm update`, `npm publish`. For these, edit package.json directly with `write`/`edit`.",
  "- Bare `npm init` (no package name) — only `npm init <name>` works, via the create-* translation above.",
  "- Native addons (better-sqlite3, sharp, etc.) — install will fail. Use pure-JS alternatives.",
  "- Raw TCP sockets (`net.createConnection`, `pg`, WebSocket servers) — won't work.",
  "- `child_process.spawn` of arbitrary binaries.",
  "- The real OS filesystem (`/etc/hosts` etc.) — only /work and the in-memory VFS exist.",
  "",
  "## Verification rules (non-negotiable)",
  "- After every `bash` call, READ the result. The tool_result includes exit code and stdout/stderr.",
  "- ANY of these in the result means FAILURE — do not declare success:",
  "  • exit code != 0",
  "  • the text 'Error:' anywhere in the output",
  "  • the text 'command not found'",
  "  • the text 'Cannot find module'",
  "  • the text 'AssertionError'",
  "  • the text 'Unexpected token'",
  "  • the text 'SyntaxError'",
  "- On failure: state what failed, why, and retry with a different approach. Two failed attempts of the same kind = stop and report the blocker, do not loop forever.",
  "- Do not claim success until you have actually run the code AND seen a passing signal (exit 0, expected stdout). 'Wrote the file' is not done.",
  "- NEVER fabricate tool output. Do not write code blocks in your reply claiming '# Output: …' unless you literally observed that text in a tool_result. The host UI shows the user the real outputs — a false claim will be visible side-by-side with the truth.",
  "- If a tool you expected isn't available (e.g. `npx`, `git` binary, `node --test`), do NOT pretend it ran. Use the alternative listed above.",
  "- If verification fails after retries, your final answer must report the failure honestly. 'I tried X, it failed with Y, here is the partial result' is acceptable. 'I successfully did X' when X failed is not.",
  "",
  "## Style",
  "- Stream a one-line plan, then act with tool calls.",
  "- Prefer one tool call per turn until you've seen the result.",
  "- Be concise.",
].join("\n");

function buildSystemPromptForBrowser(caps: RuntimeCapabilities): string {
  return defaultSystemPromptBuilder(caps) + "\n\n" + BROWSER_PROMPT_ADDENDUM;
}

// ── Public API ────────────────────────────────────────────────────────────

export interface BuildAgentOptions {
  fs: PieboxFS;
  runtime: PieboxRuntime;
  cwd: string;
  apiKey: string;
  modelId?: string;
}

export interface AgentHandle {
  driver: AgentDriver;
  modelId: string;
  sandbox: Sandbox;
  toolset: PieboxToolset;
}

/**
 * Build the playground agent: a Sandbox over PieboxFS/PieboxRuntime,
 * the 11 PieboxTools wrapped into a toolset, and a Gemini-backed
 * AgentDriver wired up with the browser system prompt.
 *
 * The driver carries multi-turn history internally — callers should
 * reuse the returned handle across `submit()` calls instead of
 * rebuilding it (which was the pre-Step-4 pattern, made obsolete by
 * the driver's own history).
 */
export function buildAgent(options: BuildAgentOptions): AgentHandle {
  const { fs, runtime, cwd, apiKey } = options;
  const modelId = options.modelId ?? "gemini-3-flash-preview";

  const llm = createGeminiLlmClient({ apiKey, model: modelId, isByok: true });
  const sandbox = createBrowserSandbox({ fs, runtime, cwd });
  const tools = buildBrowserTools(fs, runtime, cwd);
  const toolset = createToolset(tools);

  const driver = createAgentDriver({
    sandbox,
    toolset,
    llm,
    systemPromptBuilder: buildSystemPromptForBrowser,
  });

  return { driver, modelId, sandbox, toolset };
}
