import type { IRunService, RunInput, RunOutput, RunError } from "./spec.js";
import { RunInputSchema } from "./spec.js";
import type { Result } from "../shared/result.js";
import { ok, fail } from "../shared/result.js";
import { SandboxManager } from "../../sandbox-manager.js";
import { sandbox } from "../../../sandbox.js";
import type { SandboxInstance } from "../../../sandbox.js";
import type { ICloneService } from "../clone/spec.js";
import type { ICommitService } from "../commit/handler.js";
import type { IExportService } from "../export/spec.js";
import { getModel } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";
import { appendFile } from "node:fs";

/**
 * RunHandler — the orchestrator.
 *
 * Two modes:
 *   --url  → Named sandbox path: clone → prompt → commit → export (git-based diff)
 *   --dir  → Local seed path: seed → overlay → context → prompt → VFS-vs-host diff → stage output
 *
 * Bare invocation is an alias for `run`.
 */
export class RunHandler implements IRunService {
  constructor(
    private cloneHandler: ICloneService,
    private commitHandler: ICommitService,
    private exportHandler: IExportService,
    private manager: SandboxManager,
  ) {}

  async execute(input: RunInput): Promise<Result<RunOutput, RunError>> {
    const parseResult = RunInputSchema.safeParse(input);
    if (!parseResult.success) {
      return fail("INVALID_INPUT", parseResult.error.errors[0]?.message ?? "Invalid input");
    }

    const opts = parseResult.data;

    // Route to the appropriate mode
    if (opts.dir) {
      return this.executeLocalDir(opts);
    }
    return this.executeSandbox(opts);
  }

  // ── Mode 1: Named Sandbox (--url or existing sandbox) ───────────────────

  private async executeSandbox(opts: RunInput & { sandboxName?: string }): Promise<Result<RunOutput, RunError>> {
    const sandboxName = opts.sandboxName!;
    const startTime = Date.now();

    // 1. Ensure sandbox exists
    this.log(opts, `🔧 Sandbox: ${sandboxName}`);

    if (!(await this.manager.exists(sandboxName))) {
      if (opts.url) {
        this.log(opts, `🔗 Cloning ${opts.url}...`);
        const cloneRes = await this.cloneHandler.execute({ url: opts.url, sandboxName });
        if (!cloneRes.success) {
          return fail("CLONE_FAILED", cloneRes.error.message);
        }
        this.log(opts, `  ✓ Cloned`);
      } else {
        await this.manager.create(sandboxName);
        this.log(opts, `  ✓ Created empty sandbox`);
      }
    } else {
      this.log(opts, `  ✓ Loaded existing sandbox`);
    }

    // 2. Load sandbox and create session directly (for streaming)
    let sb;
    try {
      sb = await this.manager.load(sandboxName);
    } catch (e: unknown) {
      return fail("PROMPT_FAILED", e instanceof Error ? e.message : String(e));
    }

    // Collect files before prompting for change detection
    const filesBefore = new Set<string>();
    const contentsBefore = new Map<string, string>();
    this.walkVFSFlat(sb, sb.cwd, sb.cwd, (relPath, content) => {
      filesBefore.add(relPath);
      contentsBefore.set(relPath, content);
    });

    const modelName = opts.model ?? "gemini-3.1-pro-preview";
    this.log(opts, `\n🤖 Prompting ${modelName}...`);

    let session;
    try {
      session = await sb.createSession({
        model: getModel("google", modelName as any),
      });
    } catch (e: unknown) {
      return fail("SESSION_FAILED", e instanceof Error ? e.message : String(e));
    }

    // Setup logging + streaming
    const logsDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const logFile = path.join(logsDir, `${sandboxName}.jsonl`);
    this.setupStreaming(session, logFile, opts);

    try {
      await session.prompt(opts.prompt);
    } catch (e: unknown) {
      const elapsed = Date.now() - startTime;
      this.log(opts, `\n❌ Agent failed after ${(elapsed / 1000).toFixed(1)}s`);
    }

    const elapsedMs = Date.now() - startTime;
    this.log(opts, `\n${"─".repeat(40)}`);
    this.log(opts, `✓ Completed in ${(elapsedMs / 1000).toFixed(1)}s`);

    // Save sandbox state
    await this.manager.save(sandboxName, sb);

    // Detect changes by comparing before/after VFS
    const newFiles: string[] = [];
    const modifiedFiles: string[] = [];
    let unchangedCount = 0;

    this.walkVFSFlat(sb, sb.cwd, sb.cwd, (relPath, content) => {
      if (!filesBefore.has(relPath)) {
        newFiles.push(relPath);
      } else if (contentsBefore.get(relPath) !== content) {
        modifiedFiles.push(relPath);
      } else {
        unchangedCount++;
      }
    });

    // Report changes
    if (newFiles.length > 0) {
      this.log(opts, `\n  🆕 New files (${newFiles.length}):`);
      for (const f of newFiles) this.log(opts, `    A ${f}`);
    }
    if (modifiedFiles.length > 0) {
      this.log(opts, `\n  ✏️  Modified files (${modifiedFiles.length}):`);
      for (const f of modifiedFiles) this.log(opts, `    M ${f}`);
    }
    if (newFiles.length === 0 && modifiedFiles.length === 0) {
      this.log(opts, `\n  (no changes detected)`);
    } else {
      this.log(opts, `\n  📁 Unchanged: ${unchangedCount} files`);
    }

    // 3. Commit
    let commitSha: string | undefined;
    if (opts.commit) {
      const commitRes = await this.commitHandler.execute({ sandboxName, message: opts.prompt });
      if (!commitRes.success) {
        return fail("COMMIT_FAILED", commitRes.error.message);
      }
      commitSha = commitRes.data.sha;
    }

    // 4. Export
    let filesWritten = 0;
    if (opts.outPath) {
      const exportRes = await this.exportHandler.execute({ sandboxName, outPath: opts.outPath });
      if (!exportRes.success) {
        return fail("EXPORT_FAILED", exportRes.error.message);
      }
      filesWritten = exportRes.data.filesWritten;
    }

    this.log(opts, `\n  Sandbox: ${sandboxName}`);
    this.log(opts, `  To continue: piebox "next prompt" -s ${sandboxName}`);

    return ok({
      sandboxName,
      elapsedMs,
      newFiles,
      modifiedFiles,
      unchangedCount,
      filesWritten,
      bytesWritten: 0,
      commitSha,
      logFile,
    });
  }

  // ── Mode 2: Local Directory Seeding (--dir) ─────────────────────────────

  private async executeLocalDir(opts: RunInput): Promise<Result<RunOutput, RunError>> {
    const hostDir = path.resolve(opts.dir!);

    // Validate dir exists
    if (!fs.existsSync(hostDir)) {
      return fail("DIR_NOT_FOUND", `Directory not found: ${opts.dir}`);
    }

    // Resolve --from / --continue
    const outputBase = path.join(hostDir, ".piebox-output");
    let fromDir: string | null = null;

    if (opts.continue) {
      fromDir = this.resolveLatestRun(outputBase);
      if (!fromDir) {
        return fail("NO_PREVIOUS_RUN", `No previous runs found in .piebox-output/`);
      }
    } else if (opts.from) {
      fromDir = this.resolveRunDir(outputBase, opts.from);
      if (!fromDir) {
        return fail("RUN_NOT_FOUND", `Run not found: ${opts.from}`);
      }
    }

    // Create sandbox and seed
    const sb = sandbox();
    this.log(opts, "🔧 Creating sandbox...");

    this.log(opts, `📦 Seeding from ${opts.dir}`);
    const seedResult = this.seedDirToVFS(sb, hostDir, sb.cwd);
    this.log(opts, `  ✓ ${seedResult.files} files (${(seedResult.bytes / 1024).toFixed(0)}KB)`);

    // Overlay previous run
    if (fromDir) {
      const runName = path.basename(fromDir);
      this.log(opts, `🔗 Overlaying ${runName}...`);
      const overlayResult = this.seedDirToVFS(sb, fromDir, sb.cwd);
      this.log(opts, `  ✓ Overlaid ${overlayResult.files} files (${(overlayResult.bytes / 1024).toFixed(0)}KB)`);
    }

    // Inject external context
    if (opts.context && opts.context.length > 0) {
      this.log(opts, "📄 Seeding context documents...");
      const contextDir = `${sb.cwd}/.piebox-build`;
      sb.fs.mkdirSync(contextDir, { recursive: true });

      for (const contextPath of opts.context) {
        const resolved = path.resolve(contextPath);
        if (fs.existsSync(resolved)) {
          const stat = fs.statSync(resolved);
          if (stat.isDirectory()) {
            this.seedDirToVFS(sb, resolved, contextDir);
            this.log(opts, `  ✓ ${path.basename(contextPath)}/`);
          } else {
            const content = fs.readFileSync(resolved, "utf-8");
            sb.fs.writeFileSync(`${contextDir}/${path.basename(contextPath)}`, content);
            this.log(opts, `  ✓ ${path.basename(contextPath)}`);
          }
        } else {
          this.log(opts, `  ⚠ ${contextPath} not found`);
        }
      }
    }

    // Create agent session
    const modelName = opts.model ?? "gemini-3.1-pro-preview";
    this.log(opts, `\n🤖 Creating agent session (${modelName})...`);

    let session;
    try {
      session = await sb.createSession({
        model: getModel("google", modelName as any),
        systemPrompt: [
          "The repo source code is seeded at /sandbox/ in the VFS.",
          "Build context docs are at /sandbox/.piebox-build/ (if present).",
          "Follow TDD strictly. Write tests first. Make them pass. Then refactor.",
        ],
      });
    } catch (e: unknown) {
      return fail("SESSION_FAILED", e instanceof Error ? e.message : String(e));
    }

    // Setup logging
    const logsDir = path.join(hostDir, "logs");
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const runId = `run-${Date.now()}`;
    const logFile = path.join(logsDir, `${runId}.jsonl`);

    this.log(opts, `📝 Run: ${runId}`);
    this.log(opts, `   Log: ${path.relative(hostDir, logFile)}\n`);

    // Subscribe to events for streaming UX
    this.setupStreaming(session, logFile, opts);

    // Run the prompt
    this.log(opts, "─".repeat(60));
    this.log(opts, `📤 Prompt: ${opts.prompt.slice(0, 80)}${opts.prompt.length > 80 ? "..." : ""}`);
    this.log(opts, "─".repeat(60) + "\n");

    const startTime = Date.now();

    try {
      await session.prompt(opts.prompt);
    } catch (e: unknown) {
      const elapsed = Date.now() - startTime;
      this.log(opts, `\n❌ Agent failed after ${(elapsed / 1000).toFixed(1)}s`);
      // Fall through to extract partial output
    }

    const elapsedMs = Date.now() - startTime;
    this.log(opts, `\n${"─".repeat(60)}`);
    this.log(opts, `✓ Agent completed in ${(elapsedMs / 1000).toFixed(1)}s`);
    this.log(opts, "─".repeat(60));

    // Detect changes (VFS-vs-host diff)
    this.log(opts, "\n📊 Detecting changes...");
    const vfsFiles = this.collectVFS(sb, sb.cwd, sb.cwd);

    const newFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const unchangedFiles: string[] = [];

    for (const [relativePath, vfsContent] of vfsFiles) {
      const hostPath = path.join(hostDir, relativePath);

      if (!fs.existsSync(hostPath)) {
        newFiles.push(relativePath);
      } else {
        try {
          const hostContent = fs.readFileSync(hostPath, "utf-8");
          if (hostContent !== vfsContent) {
            modifiedFiles.push(relativePath);
          } else {
            unchangedFiles.push(relativePath);
          }
        } catch {
          unchangedFiles.push(relativePath);
        }
      }
    }

    // Report
    if (newFiles.length === 0 && modifiedFiles.length === 0) {
      this.log(opts, "\n  (no changes detected)");
    } else {
      if (newFiles.length > 0) {
        this.log(opts, `\n  🆕 New files (${newFiles.length}):`);
        for (const f of newFiles) this.log(opts, `    A ${f}`);
      }
      if (modifiedFiles.length > 0) {
        this.log(opts, `\n  ✏️  Modified files (${modifiedFiles.length}):`);
        for (const f of modifiedFiles) this.log(opts, `    M ${f}`);
      }
      this.log(opts, `\n  📁 Unchanged: ${unchangedFiles.length} files`);
    }

    // Extract to disk
    const applyDirectly = opts.apply;
    const outputDir = applyDirectly ? hostDir : path.join(outputBase, runId);
    const changedFiles = [...newFiles, ...modifiedFiles];
    let bytesWritten = 0;

    if (changedFiles.length > 0) {
      if (applyDirectly) {
        this.log(opts, `\n📤 Applying ${changedFiles.length} files directly to repo...`);
      } else {
        this.log(opts, `\n📤 Writing ${changedFiles.length} changed files to ${path.relative(hostDir, outputDir)}/`);
      }

      for (const relativePath of changedFiles) {
        const content = vfsFiles.get(relativePath)!;
        const targetPath = path.join(outputDir, relativePath);
        const targetDir = path.dirname(targetPath);

        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.writeFileSync(targetPath, content, "utf-8");
        bytesWritten += Buffer.byteLength(content, "utf-8");
      }

      this.log(opts, `  ✓ Wrote ${changedFiles.length} files (${(bytesWritten / 1024).toFixed(0)}KB)`);

      if (!applyDirectly) {
        this.log(opts, `\n  To review:`);
        this.log(opts, `    ls ${path.relative(hostDir, outputDir)}/`);
        this.log(opts, `\n  To apply to repo:`);
        this.log(opts, `    cp -r ${path.relative(hostDir, outputDir)}/* .`);
      }
    }

    this.log(opts, `\n📝 Full event log: ${path.relative(hostDir, logFile)}`);
    this.log(opts, "✓ Done.");

    return ok({
      runId,
      elapsedMs,
      newFiles,
      modifiedFiles,
      unchangedCount: unchangedFiles.length,
      outputDir,
      filesWritten: changedFiles.length,
      bytesWritten,
      logFile,
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private log(opts: RunInput, message: string): void {
    if (opts.quiet) return;
    process.stderr.write(message + "\n");
  }

  private resolveLatestRun(outputBase: string): string | null {
    if (!fs.existsSync(outputBase)) return null;
    const runs = fs.readdirSync(outputBase)
      .filter((d) => d.startsWith("run-"))
      .sort()
      .reverse();
    if (runs.length === 0) return null;
    return path.join(outputBase, runs[0]!);
  }

  private resolveRunDir(outputBase: string, from: string): string | null {
    const asRunDir = path.join(outputBase, from);
    if (fs.existsSync(asRunDir)) return asRunDir;
    if (fs.existsSync(from)) return path.resolve(from);
    return null;
  }

  private static readonly SKIP_DIRS = new Set([
    "node_modules", ".git", "dist", "logs", "bun.lock",
    ".piebox-output", ".piebox",
  ]);

  private seedDirToVFS(
    sb: SandboxInstance,
    hostDir: string,
    vfsDir: string,
  ): { files: number; bytes: number } {
    let files = 0;
    let bytes = 0;

    sb.fs.mkdirSync(vfsDir, { recursive: true });

    for (const entry of fs.readdirSync(hostDir, { withFileTypes: true })) {
      if (RunHandler.SKIP_DIRS.has(entry.name)) continue;

      const hostPath = path.join(hostDir, entry.name);
      const vfsPath = `${vfsDir}/${entry.name}`;

      if (entry.isDirectory()) {
        const sub = this.seedDirToVFS(sb, hostPath, vfsPath);
        files += sub.files;
        bytes += sub.bytes;
      } else {
        const stat = fs.statSync(hostPath);
        if (stat.size > 512_000) continue;

        try {
          const content = fs.readFileSync(hostPath, "utf-8");
          sb.fs.writeFileSync(vfsPath, content);
          files++;
          bytes += stat.size;
        } catch {
          // Skip binary files
        }
      }
    }

    return { files, bytes };
  }

  private collectVFS(
    sb: SandboxInstance,
    dir: string,
    base: string,
  ): Map<string, string> {
    const files = new Map<string, string>();

    try {
      const entries = sb.fs.readdirSync(dir) as string[];
      for (const entry of entries) {
        if (entry === ".piebox-build") continue;

        const fullPath = `${dir}/${entry}`;
        try {
          const stat = sb.fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const sub = this.collectVFS(sb, fullPath, base);
            for (const [p, c] of sub) files.set(p, c);
          } else {
            const relativePath = fullPath.slice(base.length + 1);
            const content = sb.fs.readFileSync(fullPath, "utf-8") as string;
            files.set(relativePath, content);
          }
        } catch {
          // skip
        }
      }
    } catch {
      // empty directory
    }

    return files;
  }

  /** Walk VFS and call back with each relative path + content */
  private walkVFSFlat(
    sb: SandboxInstance,
    dir: string,
    base: string,
    callback: (relPath: string, content: string) => void,
  ): void {
    try {
      const entries = sb.fs.readdirSync(dir) as string[];
      for (const entry of entries) {
        const fullPath = `${dir}/${entry}`;
        try {
          const stat = sb.fs.statSync(fullPath);
          if (stat.isDirectory()) {
            this.walkVFSFlat(sb, fullPath, base, callback);
          } else {
            const relativePath = fullPath.slice(base.length + 1);
            const content = sb.fs.readFileSync(fullPath, "utf-8") as string;
            callback(relativePath, content);
          }
        } catch {
          // skip
        }
      }
    } catch {
      // empty
    }
  }

  private setupStreaming(session: any, logFile: string, opts: RunInput): void {
    let thinkingBuffer = "";
    let consecutiveBash = 0;
    const MAX_BASH_SHOWN = 5;

    const log = (msg: string) => {
      if (!opts.quiet) process.stderr.write(msg + "\n");
    };

    session.subscribe((event: any) => {
      appendFile(logFile, JSON.stringify(event) + "\n", () => {});

      if (event.type !== "message_update") return;
      const inner = event.assistantMessageEvent;

      // ── Thinking (verbose only) ───────────────────────────────────
      if (inner.type === "thinking_delta") {
        thinkingBuffer += inner.delta ?? "";
        return;
      }
      if (inner.type === "thinking_end") {
        if (opts.verbose && thinkingBuffer.length > 0) {
          const clean = thinkingBuffer
            .replace(/\*\*/g, "")
            .replace(/\n+/g, " ")
            .trim()
            .slice(0, 80);
          if (clean) log(`  💭 ${clean}`);
        }
        thinkingBuffer = "";
        return;
      }

      // ── Tool calls ────────────────────────────────────────────────
      if (inner.type === "toolcall_end") {
        const tc = inner.toolCall ?? {};
        const name: string = tc.name ?? "";
        const args = tc.arguments ?? {};

        // File mutations — always shown
        if (name === "write") {
          consecutiveBash = 0;
          const p = args.path ?? "?";
          log(`  + ${p}`);
          return;
        }
        if (name === "edit") {
          consecutiveBash = 0;
          const p = args.path ?? "?";
          log(`  ~ ${p}`);
          return;
        }

        // Everything else — verbose only
        if (!opts.verbose) return;

        // Flush bash overflow before non-bash tools
        if (name !== "bash" && consecutiveBash > MAX_BASH_SHOWN) {
          log(`  ... (${consecutiveBash - MAX_BASH_SHOWN} more)`);
          consecutiveBash = 0;
        }

        if (name === "bash") {
          const cmd = typeof args.command === "string" ? args.command : "";
          consecutiveBash++;
          if (consecutiveBash <= MAX_BASH_SHOWN) {
            log(`  $ ${cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd}`);
          }
          return;
        }

        consecutiveBash = 0;
        if (name === "ls") {
          log(`  📂 ${args.path ?? "."}`);
        } else if (name === "grep") {
          log(`  🔍 grep ${args.query ?? args.pattern ?? ""}`);
        } else if (name === "find") {
          log(`  🔍 find ${args.pattern ?? ""}`);
        }
        // read is intentionally silent
      }

      if (inner.type === "text_delta" && opts.verbose) {
        process.stdout.write(inner.delta);
      }
    });
  }
}
