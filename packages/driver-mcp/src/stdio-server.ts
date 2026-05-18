#!/usr/bin/env node
/**
 * Stdio entry — the binary Claude Desktop / Cursor / any MCP host
 * spawns when configured against `@piebox/driver-mcp`.
 *
 * What it does:
 *   1. Construct a piebox `sandbox()` over the Node-side substrate
 *      (in-memory VFS + just-bash).
 *   2. Build the Layer 2 `Sandbox` adapter + the standard toolset.
 *   3. Hand both to `createMcpDriver` and connect over stdio.
 *
 * Customizing the sandbox (different cwd, preloaded git clone, custom
 * toolset, native binaries) means writing a small entry script of your
 * own that imports `createMcpDriver` directly. This file is the
 * "vanilla" default.
 *
 * Run:
 *   node packages/driver-mcp/src/stdio-server.ts
 *
 * Claude Desktop config snippet — see README.md.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { sandbox as createPieboxSandbox } from "piebox";
import {
  createSandbox,
  createStandardToolset,
  NODE_CAPABILITIES,
} from "piebox/layer2";
import type { PieboxRuntime, PieboxRunOptions, PieboxRunResult } from "piebox";
import { createMcpDriver } from "./index.js";

// ── Substrate ───────────────────────────────────────────────────────────
// The Node-side piebox sandbox composes a VFS + just-bash. Layer 2's
// Sandbox primitive wants a (fs, runtime) pair, so we adapt just-bash
// behind a thin PieboxRuntime shim — same shape `createBrowserRuntime`
// exposes for the almostnode container.

const pb = createPieboxSandbox();

const runtime: PieboxRuntime = {
  capabilities: NODE_CAPABILITIES,
  async run(cmd: string, opts: PieboxRunOptions = {}): Promise<PieboxRunResult> {
    const result = await pb.shell.exec(cmd, {
      cwd: opts.cwd ?? pb.cwd,
      signal: opts.signal,
    });
    if (opts.onStdout && result.stdout) opts.onStdout(result.stdout);
    if (opts.onStderr && result.stderr) opts.onStderr(result.stderr);
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    };
  },
} as PieboxRuntime;

const sandboxL2 = createSandbox({
  fs: pb.fs,
  runtime,
  capabilities: NODE_CAPABILITIES,
  cwd: pb.cwd,
});

const toolset = createStandardToolset(sandboxL2);

// ── Driver ──────────────────────────────────────────────────────────────

const driver = createMcpDriver({
  sandbox: sandboxL2,
  toolset,
  serverName: "piebox",
});

// ── Shutdown handling ───────────────────────────────────────────────────
// stdio servers exit when stdin closes; Claude Desktop kills the
// process on disconnect. Listen for SIGINT/SIGTERM so a manual run
// from a terminal also shuts down cleanly.

const shutdown = (signal: string): void => {
  // Log to stderr so the message doesn't poison the MCP stdout
  // channel.
  process.stderr.write(`[piebox-mcp] received ${signal}, shutting down\n`);
  void driver.stop().finally(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Connect ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await driver.start(transport);

// stderr-only banner so MCP hosts that log stderr have a hint that
// the server is up.
process.stderr.write(
  `[piebox-mcp] connected (server=piebox, tools=${toolset.tools.length})\n`,
);
