/**
 * Shared substrate translators for almostnode's known gaps.
 *
 * The agent's bash tool (in agent.ts) and the interactive Shell tab both
 * call `runInSandbox(cmd, ctx)` so the user and the agent see the same
 * translations:
 *
 *   - `npm create <pkg>` / `npm init <pkg>` → install create-pkg + run bin
 *     (almostnode's npm shim has no `create`/`init`. piebox#1, almostnode#16)
 *   - `npm create vite --template <name>` → bundled template scaffolder
 *     (bypasses create-vite which needs util.styleText. piebox#1)
 *   - `node -e '<code>'` / `node --eval '<code>'` → tempfile + node + delete
 *     (almostnode's node shim doesn't parse flags. almostnode#18, piebox#3)
 *   - bare `npm install` → install + devDeps backstop
 *     (npm install silently skips devDependencies. piebox#2, almostnode#17)
 *   - "Cannot find module .../node_modules/<pkg>" failure → append a
 *     deterministic `[piebox hint]` line that names the package and the fix.
 *
 * Every translation prints `[piebox]` notice lines so the user (or the
 * agent reading tool output) can see exactly what ran.
 *
 * Conceptually this belongs inside `piebox/browser` rather than the
 * example — see docs/explanation/portability-review.md §4. For now it
 * lives here so both consumers (agent.ts, ShellTab) can share it
 * without crossing the piebox package boundary.
 */

import type { PieboxFS, PieboxRuntime } from "piebox/browser";
import { BUNDLED_TEMPLATES } from "../templates/vite-react-ts.js";
import { tryGitArgv } from "./git-shim.js";

export interface RunCtx {
  fs: PieboxFS;
  runtime: PieboxRuntime;
  cwd: string;
  signal: AbortSignal;
  /** Streamed stdout chunks (for the interactive shell). Optional;
   *  ignored when running for the agent (which only needs the buffered
   *  result). */
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ── Patterns ──────────────────────────────────────────────────────────────

/** `npm create <name>[@version] [...rest]` / `npm init <name>...`.
 *  Name can be scoped (`@vitejs/app`) or plain (`vite`, `next-app`). */
const NPM_CREATE_RE = /^npm\s+(?:create|init)\s+(@?[\w./-]+?)(?:@([\w.-]+))?(?:\s+(.+))?$/;

/** `node -e "<code>"` / `node --eval '<code>'`. Quote handling is
 *  best-effort: matches double-, single-, or unquoted-rest forms. */
const NODE_E_RE = /^node\s+(?:-e|--eval)\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S.*))$/;

/** Bare `npm install` / `npm i` / `npm add` — the only forms that hit
 *  the devDeps-skip bug. When the user passes packages explicitly we
 *  don't second-guess them. */
const NPM_INSTALL_BARE_RE = /^npm\s+(?:install|i|add)\s*$/;

/** `Cannot find module '/.../node_modules/<pkg>/...'` — the failure
 *  signature that the [piebox hint] postprocessor latches onto. */
const CANNOT_FIND_MODULE_RE =
  /Cannot find module ['"][^'"]*?\/node_modules\/(@[^/'"]+\/[^/'"]+|[^/'"]+)/;

// ── Public surface ────────────────────────────────────────────────────────

/**
 * Single entry point. Decides whether the command needs translation and
 * runs it through the right path. Always returns the buffered result;
 * streaming callbacks (if supplied) get the same chunks live.
 */
export async function runInSandbox(cmd: string, ctx: RunCtx): Promise<RunResult> {
  if (ctx.signal.aborted) return { stdout: "", stderr: "aborted", exitCode: 130 };

  const trimmed = cmd.trim();
  if (!trimmed) return { stdout: "", stderr: "", exitCode: 0 };

  // 0. `git <subcommand>` — route to isomorphic-git via the argv shim.
  //    Almostnode has no git binary; without this the substrate would
  //    silently 127. Returns null if not a git command.
  const gitResult = await tryGitArgv(trimmed, ctx);
  if (gitResult !== null) return gitResult;

  // 1. `npm create <name>` / `npm init <name>`
  const createMatch = NPM_CREATE_RE.exec(trimmed);
  if (createMatch) {
    const [, name, version = "latest", rest = ""] = createMatch;
    return runNpmCreate(ctx, name!, version, rest);
  }

  // 2. `node -e '<code>'` / `node --eval '<code>'`
  const evalMatch = NODE_E_RE.exec(trimmed);
  if (evalMatch) {
    const code = evalMatch[1] ?? evalMatch[2] ?? evalMatch[3] ?? "";
    return runNodeE(ctx, code);
  }

  // 3. Plain pass-through to almostnode's runtime.
  const baseResult = await ctx.runtime.run(trimmed, {
    cwd: ctx.cwd,
    signal: ctx.signal,
    ...(ctx.onStdout ? { onStdout: ctx.onStdout } : {}),
    ...(ctx.onStderr ? { onStderr: ctx.onStderr } : {}),
  });

  let { stdout, stderr, exitCode } = baseResult;

  // 4. devDeps backstop after bare `npm install`.
  if (exitCode === 0 && NPM_INSTALL_BARE_RE.test(trimmed)) {
    const backstop = await installMissingDevDeps(ctx);
    if (backstop.output) {
      stdout = stdout + backstop.output;
      ctx.onStdout?.(backstop.output);
    }
  }

  // 5. `[piebox hint]` postprocessor on missing-module failures.
  if (exitCode !== 0) {
    const combined = (baseResult.stdout || "") + (baseResult.stderr || "");
    const m = CANNOT_FIND_MODULE_RE.exec(combined);
    if (m) {
      const pkg = m[1]!;
      const hint =
        `\n[piebox hint] Package '${pkg}' is NOT installed in /work/node_modules.\n` +
        `[piebox hint] Run \`npm install ${pkg}\` (or add it to package.json deps + \`npm install\`) before trying again.\n` +
        `[piebox hint] If you just scaffolded a project manually because a create-* tool failed, you MUST install the framework's runtime deps yourself — the create-* package only installed itself, not the project's dependencies.\n`;
      stderr = stderr + hint;
      ctx.onStderr?.(hint);
    }
  }

  return { stdout, stderr, exitCode };
}

// ── npm create / npm init <name> ──────────────────────────────────────────

async function runNpmCreate(
  ctx: RunCtx,
  rawName: string,
  version: string,
  rest: string,
): Promise<RunResult> {
  // Same name → create-name rule npm uses.
  const pkg = rawName.startsWith("@")
    ? rawName.replace(/^(@[^/]+)\/(.+)$/, "$1/create-$2")
    : `create-${rawName}`;
  // Drop bash's `--` forwarding separator; the create binary owns its argv parser.
  const args = rest.replace(/(^|\s)--(\s+|$)/g, " ").trim();

  // Short-circuit: bundled Vite templates (piebox#1 mitigation).
  if (rawName === "vite") {
    const tmplMatch = /--template\s+(\S+)/.exec(args);
    const tmplName = tmplMatch?.[1] ?? "react-ts";
    const template = BUNDLED_TEMPLATES[tmplName];
    if (template) {
      return scaffoldFromTemplate(ctx, tmplName, template);
    }
  }

  const notice =
    `[piebox] npm create/init is not in almostnode's shim; translating to:\n` +
    `[piebox]   npm install ${pkg}@${version}\n` +
    `[piebox]   node ./node_modules/${pkg}/<bin> ${args || "(no args)"}\n` +
    `[piebox] Limits: no TTY (interactive prompts fail), no INIT_CWD/npm_* env vars.\n` +
    `[piebox] Use --template / --yes / --ts flags for non-interactive scaffolders.\n` +
    `[piebox] ─────\n`;
  ctx.onStdout?.(notice);

  const install = await ctx.runtime.run(`npm install ${pkg}@${version}`, {
    cwd: ctx.cwd,
    signal: ctx.signal,
    ...(ctx.onStdout ? { onStdout: ctx.onStdout } : {}),
    ...(ctx.onStderr ? { onStderr: ctx.onStderr } : {}),
  });
  const installOut = (install.stdout || "") + (install.stderr || "");
  if (install.exitCode !== 0) {
    const tail = `\n[piebox] install of ${pkg}@${version} failed (exit ${install.exitCode}); aborting translation.\n`;
    ctx.onStderr?.(tail);
    return { stdout: "", stderr: notice + installOut + tail, exitCode: install.exitCode };
  }

  let binPath: string;
  try {
    const raw = ctx.fs.readFileSync(
      `${ctx.cwd}/node_modules/${pkg}/package.json`,
      "utf-8",
    ) as string;
    const pkgJson = JSON.parse(raw) as { bin?: string | Record<string, string> };
    if (typeof pkgJson.bin === "string") binPath = pkgJson.bin;
    else if (pkgJson.bin && typeof pkgJson.bin === "object") {
      const entries = Object.values(pkgJson.bin);
      if (entries.length === 0) throw new Error("empty bin object");
      binPath = entries[0]!;
    } else throw new Error(`no bin field in ${pkg}/package.json — not a runnable scaffolder`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const tail = `\n[piebox] cannot resolve bin for ${pkg}: ${msg}\n`;
    ctx.onStderr?.(tail);
    return { stdout: "", stderr: notice + installOut + tail, exitCode: 1 };
  }

  const runCmd = `node ./node_modules/${pkg}/${binPath} ${args}`.trim();
  ctx.onStdout?.(`\n[piebox] $ ${runCmd}\n`);
  const run = await ctx.runtime.run(runCmd, {
    cwd: ctx.cwd,
    signal: ctx.signal,
    ...(ctx.onStdout ? { onStdout: ctx.onStdout } : {}),
    ...(ctx.onStderr ? { onStderr: ctx.onStderr } : {}),
  });
  const combined =
    notice + installOut + `\n[piebox] $ ${runCmd}\n` + (run.stdout || "") + (run.stderr || "");
  if (run.exitCode === 0) return { stdout: combined, stderr: "", exitCode: 0 };
  return { stdout: "", stderr: combined, exitCode: run.exitCode };
}

// ── node -e '<code>' ──────────────────────────────────────────────────────

async function runNodeE(ctx: RunCtx, code: string): Promise<RunResult> {
  const tmpName = `__piebox_eval_${Date.now()}.mjs`;
  const tmpPath = `${ctx.cwd}/${tmpName}`;

  const notice =
    `[piebox] \`node -e\` flag not in almostnode's node shim; translating to:\n` +
    `[piebox]   write ${tmpName} (${code.length} chars)\n` +
    `[piebox]   node ${tmpName}\n` +
    `[piebox]   delete ${tmpName}\n` +
    `[piebox] ─────\n`;
  ctx.onStdout?.(notice);

  try {
    ctx.fs.writeFileSync(tmpPath, code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { stdout: "", stderr: notice + msg, exitCode: 1 };
  }

  const run = await ctx.runtime.run(`node ${tmpName}`, {
    cwd: ctx.cwd,
    signal: ctx.signal,
    ...(ctx.onStdout ? { onStdout: ctx.onStdout } : {}),
    ...(ctx.onStderr ? { onStderr: ctx.onStderr } : {}),
  });

  try { ctx.fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }

  const combined = notice + (run.stdout || "") + (run.stderr || "");
  if (run.exitCode === 0) {
    return { stdout: combined, stderr: "", exitCode: 0 };
  }
  return { stdout: "", stderr: combined, exitCode: run.exitCode };
}

// ── bundled Vite template scaffolder ──────────────────────────────────────

function scaffoldFromTemplate(
  ctx: RunCtx,
  templateName: string,
  files: Record<string, string>,
): RunResult {
  const header =
    `[piebox] npm create vite --template ${templateName} → bundled template scaffolder\n` +
    `[piebox] (piebox#1: create-vite@9 fails on almostnode's missing util.styleText)\n` +
    `[piebox] writing ${Object.keys(files).length} file(s) to ${ctx.cwd}...\n`;
  const lines: string[] = [header];
  ctx.onStdout?.(header);

  try {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = `${ctx.cwd}/${relPath}`;
      const parent = fullPath.split("/").slice(0, -1).join("/") || "/";
      ctx.fs.mkdirSync(parent, { recursive: true });
      ctx.fs.writeFileSync(fullPath, content);
      const line = `  + ${relPath} (${content.length} bytes)\n`;
      lines.push(line);
      ctx.onStdout?.(line);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const tail = `\n[piebox] write failed: ${msg}\n`;
    ctx.onStderr?.(tail);
    return { stdout: "", stderr: lines.join("") + tail, exitCode: 1 };
  }

  const footer =
    `\n[piebox] template installed. Next steps:\n` +
    `[piebox]   1. npm install                              # installs all deps from package.json\n` +
    `[piebox]   2. node ./node_modules/vite/bin/vite.js     # starts dev server (preview iframe will appear)\n`;
  lines.push(footer);
  ctx.onStdout?.(footer);
  return { stdout: lines.join(""), stderr: "", exitCode: 0 };
}

// ── devDeps backstop ──────────────────────────────────────────────────────

async function installMissingDevDeps(
  ctx: RunCtx,
): Promise<{ added: string[]; failed: string[]; output: string }> {
  const lines: string[] = [];
  const added: string[] = [];
  const failed: string[] = [];

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
      const spec =
        version.startsWith("^") || version.startsWith("~") || /^\d/.test(version)
          ? `${name}@${version}`
          : name;
      lines.push(`[piebox]   npm install ${spec}`);
      const r = await ctx.runtime.run(`npm install ${spec}`, {
        cwd: ctx.cwd,
        signal: ctx.signal,
      });
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
