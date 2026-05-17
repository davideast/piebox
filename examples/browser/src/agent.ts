/**
 * In-browser agent session, built on:
 *   • @inbrowser/agent       — the agent loop (browser-safe by design)
 *   • @inbrowser/relay       — Gemini SSE provider (called directly, no relay server)
 *   • piebox/browser         — PieboxFS + PieboxRuntime
 *
 * The LlmClient adapts @inbrowser/relay's `buildGeminiRequest` +
 * `geminiEventsFromResponse` into @inbrowser/agent's ChatEvent stream. Tool
 * handlers wire to PieboxFS / PieboxRuntime so `write`, `read`, `bash`,
 * etc. operate on the almostnode-backed virtual filesystem.
 */

import {
  createAgentSession,
  createReactLoopStrategy,
  createToolRegistry,
  createDispatch,
  createMetricsCollector,
  EMPTY_WORKSPACE,
  EMPTY_RUNTIME,
  type AgentSession,
  type ChatEvent,
  type ChatMessage as SdkChatMessage,
  type LlmClient,
  type LlmConfig,
  type ToolHandler,
  type ToolContext,
  type ToolResult,
  type JsonSchema,
  type Tracer,
} from "@inbrowser/agent";
import {
  buildGeminiRequest,
  geminiEventsFromResponse,
} from "@inbrowser/relay/providers/gemini";
import type { PieboxFS, PieboxRuntime } from "piebox/browser";
import { BUNDLED_TEMPLATES } from "./templates/vite-react-ts.js";
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

// ── Gemini LlmClient via @inbrowser/relay ─────────────────────────────────

function createGeminiClient(cfg: LlmConfig): LlmClient {
  return {
    id: `gemini:${cfg.model}`,
    supportsTools: true,
    async *chat(req, signal) {
      // Translate @inbrowser/agent's NormalizedMessage → relay's
      // LegacyChatMessage. Same role + text shape, plus optional toolCalls
      // on assistant messages and toolCallId on tool messages.
      const messages = req.messages.map((m) => ({
        role: m.role,
        text: m.text ?? "",
        toolCalls: m.toolCalls,
        toolCallId: (m as any).toolCallId,
        toolName: (m as any).toolName,
      })) as any;

      const request = buildGeminiRequest({
        provider: "gemini",
        model: cfg.model,
        messages,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters as any,
        })),
        apiKey: cfg.apiKey ?? "",
        signal,
      });

      let response: Response;
      try {
        response = await fetch(request);
      } catch (e) {
        yield { kind: "error", message: e instanceof Error ? e.message : String(e) };
        return;
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        yield {
          kind: "error",
          message: `gemini ${response.status}: ${body.slice(0, 400)}`,
        };
        return;
      }

      let prompt = 0;
      let output = 0;
      let cached = 0;

      for await (const ev of geminiEventsFromResponse(response, signal)) {
        switch (ev.kind) {
          case "text":
            yield { kind: "text", chunk: ev.chunk };
            break;
          case "thinking":
            yield { kind: "thinking", chunk: ev.chunk };
            break;
          case "tool_call":
            yield {
              kind: "tool_call",
              id: ev.callId,
              name: ev.name,
              args: ev.args,
              signature: ev.signature,
            };
            break;
          case "usage":
            prompt = ev.promptTokens;
            output = ev.outputTokens;
            cached = ev.cachedTokens ?? 0;
            break;
          case "error":
            yield { kind: "error", message: ev.message };
            break;
        }
      }

      yield {
        kind: "turn_complete",
        usage: {
          promptTokens: prompt,
          completionTokens: output,
          cachedTokens: cached,
        },
        details: { requestedModel: cfg.model },
      };
    },
  };
}

// ── Tool handlers backed by PieboxFS + PieboxRuntime ──────────────────────

interface ToolDeps { fs: PieboxFS; runtime: PieboxRuntime; cwd: string }

function resolvePath(cwd: string, p: string): string {
  if (p.startsWith("/")) return p;
  if (cwd.endsWith("/")) return cwd + p;
  return `${cwd}/${p}`;
}

function ok(summary: string, data?: unknown): ToolResult {
  return { ok: true, summary, data };
}
function fail(summary: string, data?: unknown): ToolResult {
  return { ok: false, summary, data };
}

// ── `npm create` / `npm init <name>` translation ──────────────────────────
// STOPGAP: almostnode's npm shim (shims/child_process.ts) doesn't implement
// `create` or `init <pkg>`. The architecturally correct fix is to add those
// cases to almostnode's npm switch alongside install/run/start/test/ls.
// Until that PR lands, this wrapper does the translation in piebox's bash
// tool.
//
// What npm actually does for `npm create <x>`:
//   1. translate `<x>` → `create-<x>` (or `@scope/<x>` → `@scope/create-<x>`)
//   2. ensure the package is available (npm exec / cache resolve)
//   3. spawn its `bin` entry with INIT_CWD set, in a TTY, with npm_* env vars
//
// What we do — a *simplification*, not a faithful copy:
//   1. apply the same name → create-name rule (faithful)
//   2. `npm install <create-pkg>@<version>` into the project node_modules
//      (npm uses a temp/cache; we don't — that's the cosmetic diff)
//   3. resolve the bin from the installed package.json
//   4. `node ./node_modules/<create-pkg>/<bin>` with the user's args
//
// What we miss vs. real npm: TTY/interactivity, `INIT_CWD`,
// `npm_command` / `npm_config_*` env vars, the npm-managed cache. Documented
// in the system prompt + surfaced to the agent in the bash output below.

// Matches `npm create <name>[@version] [...rest]` and `npm init <name>...`.
// Name may be scoped (`@vitejs/app`) or plain (`vite`, `next-app`).
const NPM_CREATE_RE = /^npm\s+(?:create|init)\s+(@?[\w./-]+?)(?:@([\w.-]+))?(?:\s+(.+))?$/;

// Matches `node -e "<code>"` or `node --eval '<code>'` — almostnode's node
// shim doesn't parse flags, so we capture the code and run it via a tempfile.
// STOPGAP for piebox#3 (node flag parsing). Quote handling is best-effort.
const NODE_E_RE = /^node\s+(?:-e|--eval)\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S.*))$/;

// Matches bare `npm install` / `npm i` / `npm add` (no package argument, no
// flags that suppress devDeps). The backstop only runs in this case — when
// the agent passes packages explicitly, we don't second-guess them.
const NPM_INSTALL_BARE_RE = /^npm\s+(?:install|i|add)\s*$/;

/**
 * STOPGAP for piebox#2: almostnode's `npm install` (no args) silently skips
 * devDependencies. After the real install runs, read /work/package.json and
 * install any devDeps that aren't in node_modules. The agent sees a
 * `[piebox]` notice listing what was added.
 */
async function installMissingDevDeps(
  ctx: { fs: PieboxFS; runtime: PieboxRuntime; cwd: string; signal: AbortSignal },
): Promise<{ added: string[]; failed: string[]; output: string }> {
  const lines: string[] = [];
  let added: string[] = [];
  let failed: string[] = [];

  try {
    const pkgJsonRaw = ctx.fs.readFileSync(`${ctx.cwd}/package.json`, "utf-8") as string;
    const pkgJson = JSON.parse(pkgJsonRaw) as { devDependencies?: Record<string, string> };
    const devDeps = pkgJson.devDependencies ?? {};
    const missing: Array<[string, string]> = [];
    for (const [name, version] of Object.entries(devDeps)) {
      const isInstalled = ctx.fs.existsSync(`${ctx.cwd}/node_modules/${name}/package.json`);
      if (!isInstalled) missing.push([name, version]);
    }
    if (missing.length === 0) return { added, failed, output: "" };

    lines.push(
      `\n[piebox] piebox#2 backstop: \`npm install\` skipped ${missing.length} devDependency entries.`,
      `[piebox] installing them individually (the per-package install path works):`,
    );
    for (const [name, version] of missing) {
      const spec = version.startsWith("^") || version.startsWith("~") || /^\d/.test(version)
        ? `${name}@${version}`
        : name; // git/file/etc specs we'd need to think about; for now pass bare
      lines.push(`[piebox]   npm install ${spec}`);
      const r = await ctx.runtime.run(`npm install ${spec}`, { cwd: ctx.cwd, signal: ctx.signal });
      if (r.exitCode === 0) added.push(name);
      else {
        failed.push(name);
        lines.push(`[piebox]   ↳ ${name} install failed (exit ${r.exitCode})`);
      }
    }
    if (added.length) lines.push(`[piebox] backstop installed: ${added.join(", ")}`);
    if (failed.length) lines.push(`[piebox] backstop FAILED for: ${failed.join(", ")}`);
  } catch (e) {
    lines.push(`[piebox] devDeps backstop skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { added, failed, output: lines.join("\n") + "\n" };
}

/**
 * STOPGAP for almostnode#18: write the inline code to a tempfile, run it,
 * delete the tempfile. The agent sees a `[piebox]` notice explaining what
 * happened so the translation is debuggable.
 */
async function runNodeE(
  ctx: { fs: PieboxFS; runtime: PieboxRuntime; cwd: string; signal: AbortSignal },
  code: string,
): Promise<ToolResult> {
  const tmpName = `__piebox_eval_${Date.now()}.mjs`;
  const tmpPath = `${ctx.cwd}/${tmpName}`;

  const notice =
    `[piebox] \`node -e\` flag not in almostnode's node shim; translating to:\n` +
    `[piebox]   write ${tmpName} (${code.length} chars)\n` +
    `[piebox]   node ${tmpName}\n` +
    `[piebox]   delete ${tmpName}\n` +
    `[piebox] ─────\n`;

  try {
    ctx.fs.writeFileSync(tmpPath, code);
  } catch (e) {
    return {
      ok: false,
      summary: `node -e failed: tempfile write`,
      data: { stdout: "", stderr: notice + (e instanceof Error ? e.message : String(e)), exitCode: 1 },
    };
  }

  const run = await ctx.runtime.run(`node ${tmpName}`, { cwd: ctx.cwd, signal: ctx.signal });

  // Best-effort cleanup; never let it shadow the real result.
  try { ctx.fs.unlinkSync(tmpPath); } catch { /* no-op */ }

  const combined = notice + (run.stdout || "") + (run.stderr || "");
  if (run.exitCode === 0) {
    return { ok: true, summary: `exit=0 (translated from node -e)`, data: { stdout: combined, stderr: "", exitCode: 0 } };
  }
  return { ok: false, summary: `exit=${run.exitCode}`, data: { stdout: "", stderr: combined, exitCode: run.exitCode } };
}

/**
 * Write a bundled template's files directly into the cwd. Used to bypass
 * `create-*` packages that hit substrate gaps (e.g. create-vite needs
 * `util.styleText` which almostnode doesn't ship; see piebox#1).
 *
 * The agent gets a `[piebox]` notice explaining the swap so the markdown
 * record of the session shows where the files came from.
 */
function scaffoldFromTemplate(
  ctx: { fs: PieboxFS; cwd: string },
  templateName: string,
  files: Record<string, string>,
): ToolResult {
  const notice =
    `[piebox] npm create vite --template ${templateName} → bundled template scaffolder\n` +
    `[piebox] (piebox#1: create-vite@9 fails on almostnode's missing util.styleText)\n` +
    `[piebox] writing ${Object.keys(files).length} file(s) to ${ctx.cwd}...\n`;
  const lines: string[] = [notice];

  try {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = `${ctx.cwd}/${relPath}`;
      const parent = fullPath.split("/").slice(0, -1).join("/") || "/";
      ctx.fs.mkdirSync(parent, { recursive: true });
      ctx.fs.writeFileSync(fullPath, content);
      lines.push(`  + ${relPath} (${content.length} bytes)`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      summary: `bundled template '${templateName}' failed during write: ${msg}`,
      data: { stdout: "", stderr: lines.join("\n") + `\n[piebox] write failed: ${msg}\n`, exitCode: 1 },
    };
  }

  lines.push(
    "",
    `[piebox] template installed. Next steps:`,
    `[piebox]   1. npm install                              # installs all deps from package.json`,
    `[piebox]   2. node ./node_modules/vite/bin/vite.js     # starts dev server (preview iframe will appear)`,
    ``,
  );
  return {
    ok: true,
    summary: `scaffolded ${templateName} template (${Object.keys(files).length} files)`,
    data: { stdout: lines.join("\n"), stderr: "", exitCode: 0 },
  };
}

async function runNpmCreate(
  ctx: { fs: PieboxFS; runtime: PieboxRuntime; cwd: string; signal: AbortSignal },
  rawName: string,
  version: string,
  rest: string,
): Promise<ToolResult> {
  // npm's documented translation rule.
  const pkg = rawName.startsWith("@")
    ? rawName.replace(/^(@[^/]+)\/(.+)$/, "$1/create-$2")
    : `create-${rawName}`;
  // Strip bash's `--` forwarding separator; the create binary owns its argv parser.
  const args = rest.replace(/(^|\s)--(\s+|$)/g, " ").trim();

  // ── Short-circuit: bundled templates (piebox#1 mitigation) ─────────────
  // For known `npm create vite --template <name>` invocations, write the
  // template files directly. Bypasses create-vite entirely (which fails on
  // almostnode's missing util.styleText). Bundled templates also pre-stage
  // their package.json with everything in `dependencies` to sidestep
  // piebox#2 (npm install skipping devDeps).
  if (rawName === "vite") {
    const tmplMatch = /--template\s+(\S+)/.exec(args);
    const tmplName = tmplMatch?.[1] ?? "react-ts";
    const template = BUNDLED_TEMPLATES[tmplName];
    if (template) {
      return scaffoldFromTemplate(ctx, tmplName, template);
    }
    // Unknown template: fall through to the install+run path so the agent
    // at least sees the failure mode it expects.
  }

  const notice =
    `[piebox] npm create/init is not in almostnode's shim; translating to:\n` +
    `[piebox]   npm install ${pkg}@${version}\n` +
    `[piebox]   node ./node_modules/${pkg}/<bin> ${args || "(no args)"}\n` +
    `[piebox] Limits: no TTY (interactive prompts fail), no INIT_CWD/npm_* env vars.\n` +
    `[piebox] Use --template / --yes / --ts flags for non-interactive scaffolders.\n` +
    `[piebox] ─────\n`;

  // Step 1: install the create-* package.
  const install = await ctx.runtime.run(`npm install ${pkg}@${version}`, {
    cwd: ctx.cwd,
    signal: ctx.signal,
  });
  const installOut = (install.stdout || "") + (install.stderr || "");
  if (install.exitCode !== 0) {
    const combined =
      notice + installOut +
      `\n[piebox] install of ${pkg}@${version} failed (exit ${install.exitCode}); aborting translation.\n`;
    return {
      ok: false,
      summary: `npm create failed: install exited ${install.exitCode}`,
      data: { stdout: "", stderr: combined, exitCode: install.exitCode },
    };
  }

  // Step 2: resolve the bin entry from the installed package.json.
  let binPath: string;
  try {
    const raw = ctx.fs.readFileSync(
      `${ctx.cwd}/node_modules/${pkg}/package.json`,
      "utf-8",
    ) as string;
    const pkgJson = JSON.parse(raw) as { bin?: string | Record<string, string> };
    if (typeof pkgJson.bin === "string") {
      binPath = pkgJson.bin;
    } else if (pkgJson.bin && typeof pkgJson.bin === "object") {
      const entries = Object.values(pkgJson.bin);
      if (entries.length === 0) throw new Error("empty bin object");
      binPath = entries[0]!;
    } else {
      throw new Error(`no bin field in ${pkg}/package.json — not a runnable scaffolder`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const combined = notice + installOut + `\n[piebox] cannot resolve bin for ${pkg}: ${msg}\n`;
    return {
      ok: false,
      summary: `npm create failed: bin resolution`,
      data: { stdout: "", stderr: combined, exitCode: 1 },
    };
  }

  // Step 3: run the bin via node.
  const runCmd = `node ./node_modules/${pkg}/${binPath} ${args}`.trim();
  const run = await ctx.runtime.run(runCmd, { cwd: ctx.cwd, signal: ctx.signal });
  const combined =
    notice + installOut + `\n[piebox] $ ${runCmd}\n` + (run.stdout || "") + (run.stderr || "");

  if (run.exitCode === 0) {
    return {
      ok: true,
      summary: `npm create succeeded (translated to install + node ./node_modules/${pkg}/${binPath})`,
      data: { stdout: combined, stderr: "", exitCode: 0 },
    };
  }
  return {
    ok: false,
    summary: `npm create failed: ${pkg} bin exited ${run.exitCode}`,
    data: { stdout: "", stderr: combined, exitCode: run.exitCode },
  };
}

function buildTools(deps: ToolDeps): ToolHandler[] {
  const { fs, runtime, cwd } = deps;

  const writeTool: ToolHandler = {
    name: "write",
    description: "Create or overwrite a file with the given content. Use for new files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or cwd-relative path." },
        content: { type: "string", description: "Full UTF-8 content for the file." },
      },
      required: ["path", "content"],
    },
    async execute(args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
      const { path, content } = args as { path: string; content: string };
      const resolved = resolvePath(cwd, path);
      const parent = resolved.split("/").slice(0, -1).join("/") || "/";
      try {
        fs.mkdirSync(parent, { recursive: true });
        fs.writeFileSync(resolved, content);
        return ok(`wrote ${resolved} (${content.length} bytes)`);
      } catch (e) {
        return fail(`write failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const readTool: ToolHandler = {
    name: "read",
    description: "Read a file's UTF-8 contents.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    async execute(args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
      const { path } = args as { path: string };
      try {
        const text = fs.readFileSync(resolvePath(cwd, path), "utf-8") as string;
        return ok(`read ${path} (${text.length} bytes)`, { content: text });
      } catch (e) {
        return fail(`read failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const editTool: ToolHandler = {
    name: "edit",
    description: "Replace exactly `oldText` with `newText` in `path`. `oldText` must appear once.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
    },
    async execute(args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
      const { path, oldText, newText } = args as { path: string; oldText: string; newText: string };
      const resolved = resolvePath(cwd, path);
      try {
        const cur = fs.readFileSync(resolved, "utf-8") as string;
        const idx = cur.indexOf(oldText);
        if (idx < 0) return fail(`edit failed: oldText not found in ${path}`);
        if (cur.indexOf(oldText, idx + oldText.length) >= 0) {
          return fail(`edit failed: oldText appears more than once in ${path}`);
        }
        const next = cur.slice(0, idx) + newText + cur.slice(idx + oldText.length);
        fs.writeFileSync(resolved, next);
        return ok(`edited ${path}`);
      } catch (e) {
        return fail(`edit failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const bashTool: ToolHandler = {
    name: "bash",
    description:
      "Run a shell command in the in-browser sandbox. `node` and `npm` work. " +
      "`npm create <name>` and `npm init <name>` are translated by piebox to install + run-bin (see [piebox] notice in output for limits).",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
    async execute(args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
      const { command } = args as { command: string };

      // Pattern: `npm create <name>[@version] [...rest]` or `npm init <name>...`
      const m = NPM_CREATE_RE.exec(command.trim());
      if (m) {
        const [, name, version = "latest", rest = ""] = m;
        return await runNpmCreate(
          { fs, runtime, cwd, signal: ctx.signal },
          name!,
          version,
          rest,
        );
      }

      // Pattern: `node -e "<code>"` / `node --eval '<code>'`
      const eMatch = NODE_E_RE.exec(command.trim());
      if (eMatch) {
        const code = eMatch[1] ?? eMatch[2] ?? eMatch[3] ?? "";
        return await runNodeE({ fs, runtime, cwd, signal: ctx.signal }, code);
      }

      try {
        const r = await runtime.run(command, { cwd, signal: ctx.signal });
        let stdout = r.stdout;
        let stderr = r.stderr;

        // Backstop: bare `npm install` post-processing (piebox#2).
        if (r.exitCode === 0 && NPM_INSTALL_BARE_RE.test(command.trim())) {
          const backstop = await installMissingDevDeps({ fs, runtime, cwd, signal: ctx.signal });
          if (backstop.output) stdout = (stdout ?? "") + backstop.output;
        }

        // Deterministic hint: when a command fails with "Cannot find module
        // /.../node_modules/<pkg>/...", append a [piebox hint] line that
        // names the missing package and the fix. Caught even when the model
        // would otherwise gloss over the failure.
        if (r.exitCode !== 0) {
          const combined = (r.stdout || "") + (r.stderr || "");
          const m = /Cannot find module ['"][^'"]*?\/node_modules\/(@[^/'"]+\/[^/'"]+|[^/'"]+)/.exec(combined);
          if (m) {
            const pkg = m[1]!;
            const hint =
              `\n[piebox hint] Package '${pkg}' is NOT installed in /work/node_modules.\n` +
              `[piebox hint] Run \`npm install ${pkg}\` (or add it to package.json deps + \`npm install\`) before trying again.\n` +
              `[piebox hint] If you just scaffolded a project manually because a create-* tool failed, you MUST install the framework's runtime deps yourself — the create-* package only installed itself, not the project's dependencies.\n`;
            stderr = (stderr ?? "") + hint;
          }
        }
        const summary = `exit=${r.exitCode}`;
        const data = { stdout, stderr, exitCode: r.exitCode };
        return r.exitCode === 0 ? ok(summary, data) : fail(summary, data);
      } catch (e) {
        return fail(`bash failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const lsTool: ToolHandler = {
    name: "ls",
    description: "List directory entries.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    async execute(args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
      const { path } = args as { path: string };
      const resolved = resolvePath(cwd, path);
      try {
        const dirents = fs.readdirSync(resolved, { withFileTypes: true });
        const lines = dirents.map((d) =>
          d.isDirectory() ? `${d.name}/` : d.name,
        );
        return ok(`${lines.length} entries in ${path}`, { entries: lines });
      } catch (e) {
        return fail(`ls failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  // ── git tools (backed by isomorphic-git over the same PieboxFS) ─────
  const gitCtx = { fs, dir: cwd };

  const gitInitTool: ToolHandler = {
    name: "git_init",
    description: "Initialize a git repo at the cwd. Optionally set the default branch (defaults to 'main').",
    parameters: {
      type: "object",
      properties: { defaultBranch: { type: "string" } },
    },
    async execute(args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
      const { defaultBranch } = args as { defaultBranch?: string };
      try {
        await gitInit(gitCtx, defaultBranch ?? "main");
        return ok(`initialized git repo at ${cwd} (default branch: ${defaultBranch ?? "main"})`);
      } catch (e) {
        return fail(`git_init failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const gitStatusTool: ToolHandler = {
    name: "git_status",
    description: "List files that differ between HEAD, the index, and the working directory.",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
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

  const gitAddTool: ToolHandler = {
    name: "git_add",
    description: "Stage a file. Pass `filepath` (cwd-relative) for a single file, or set `all: true` to stage everything that differs.",
    parameters: {
      type: "object",
      properties: {
        filepath: { type: "string", description: "cwd-relative file path" },
        all: { type: "boolean", description: "Stage all modified/new files" },
      },
    },
    async execute(args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
      const { filepath, all } = args as { filepath?: string; all?: boolean };
      try {
        if (all) {
          const touched = await gitAddAll(gitCtx);
          return ok(`staged ${touched.length} file(s)`, { staged: touched });
        }
        if (!filepath) return fail("git_add needs `filepath` or `all: true`");
        // Strip leading cwd if the model passed an absolute path.
        const rel = filepath.startsWith(cwd + "/") ? filepath.slice(cwd.length + 1) : filepath;
        await gitAdd(gitCtx, rel);
        return ok(`staged ${rel}`);
      } catch (e) {
        return fail(`git_add failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const gitCommitTool: ToolHandler = {
    name: "git_commit",
    description: "Commit staged changes. Provide `message` (required); optionally `author.name` and `author.email`.",
    parameters: {
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
    async execute(args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
      const { message, author } = args as { message: string; author?: { name: string; email: string } };
      try {
        const sha = await gitCommit(gitCtx, message, author);
        return ok(`committed ${sha.slice(0, 8)}: ${message}`, { sha });
      } catch (e) {
        return fail(`git_commit failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const gitLogTool: ToolHandler = {
    name: "git_log",
    description: "Return the most recent commits (default depth 10).",
    parameters: {
      type: "object",
      properties: { depth: { type: "number" } },
    },
    async execute(args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
      const { depth } = args as { depth?: number };
      try {
        const entries = await gitLog(gitCtx, depth ?? 10);
        const summary = entries.length === 0
          ? "no commits yet"
          : `${entries.length} commit(s): ${entries.map((e) => `${e.oid.slice(0, 7)} ${e.message}`).join(" | ")}`;
        return ok(summary, { commits: entries });
      } catch (e) {
        return fail(`git_log failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  const gitBranchTool: ToolHandler = {
    name: "git_branch",
    description: "Branch operations. Pass `name` to create (and `checkout: true` to switch). Pass nothing to list branches. Pass `current: true` to report the current branch.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        checkout: { type: "boolean" },
        current: { type: "boolean" },
      },
    },
    async execute(args, ctx) {
      if (ctx.signal.aborted) return fail("cancelled");
      const { name, checkout, current } = args as { name?: string; checkout?: boolean; current?: boolean };
      try {
        if (current) {
          const b = await gitCurrentBranch(gitCtx);
          return ok(`current branch: ${b ?? "(detached)"}`, { branch: b });
        }
        if (!name) {
          const list = await gitListBranches(gitCtx);
          return ok(`${list.length} branch(es): ${list.join(", ")}`, { branches: list });
        }
        await gitBranch(gitCtx, name, checkout ?? false);
        return ok(`created branch ${name}${checkout ? " (checked out)" : ""}`);
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

// ── System prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You are a coding agent operating inside a sandboxed in-browser Node.js environment (almostnode).",
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

// ── Build session ─────────────────────────────────────────────────────────

export interface BuildAgentOptions {
  fs: PieboxFS;
  runtime: PieboxRuntime;
  cwd: string;
  apiKey: string;
  modelId?: string;
  /** Prior turns to thread into the LLM context. Tool calls + results
   *  must be embedded on assistant messages so the model sees what it
   *  did in earlier turns (the SDK session only persists assistant
   *  *text* across submits, so we rebuild the session each turn). */
  history?: SdkChatMessage[];
  /** Optional trace sink. Zero cost when absent. */
  tracer?: Tracer;
}

export interface AgentHandle {
  session: AgentSession;
  modelId: string;
}

export function buildAgent(options: BuildAgentOptions): AgentHandle {
  const { fs, runtime, cwd, apiKey } = options;
  const modelId = options.modelId ?? "gemini-3-flash-preview";

  const llm = createGeminiClient({ apiKey, model: modelId, isByok: true });

  const tools = buildTools({ fs, runtime, cwd });
  const registry = createToolRegistry();
  for (const t of tools) registry.register(t);

  const session = createAgentSession({
    strategy: createReactLoopStrategy(),
    llm,
    tools: createDispatch(registry),
    toolList: tools,
    toolContext: () => ({
      workspace: EMPTY_WORKSPACE,
      runtime: EMPTY_RUNTIME,
      signal: new AbortController().signal,
    }),
    metrics: createMetricsCollector(),
    history: options.history ?? [],
    systemPromptBuilder: () => SYSTEM_PROMPT,
    tracer: options.tracer,
  });

  return { session, modelId };
}
