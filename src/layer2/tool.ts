/**
 * Layer 2 tool descriptor and toolset interfaces.
 *
 * A `PieboxTool` is the unit drivers (agent loop, MCP server, CLI,
 * direct API) adapt to their own protocols. The interface is
 * deliberately small: `execute(args, sandbox, signal)`. No agent-SDK
 * `ToolContext`, no `workspace`, no driver-shaped runtime.
 *
 * The shape and the rationale come from investigation C
 * (`docs/investigations/C-driver-spikes/`). Three driver spikes
 * compiled cleanly against this contract with no `any` and no
 * `@ts-ignore`. Four convergent revisions from those spikes are
 * already baked in here:
 *   - `PieboxResult.exitCode` field for process-shaped tools
 *   - `PieboxToolset.get(name)` for driver dispatch
 *   - (sandbox lifecycle hook lives in `./sandbox.ts`)
 *   - (abort semantics documented on `Sandbox.destroy`)
 */

import type { Sandbox } from "./sandbox.js";

// ── Tool result ──────────────────────────────────────────────────────────

/**
 * Protocol-neutral result every tool returns. Drivers adapt:
 *   - agent SDK: `ok` / `summary` / `data` already match
 *   - MCP: `summary` → `Content[]` text; `ok === false` OR
 *     `exitCode !== 0` → isError
 *   - CLI: `exitCode` shows as `[exit N]`; `data` → JSON stdout
 */
export interface PieboxResult<Data = unknown> {
  ok: boolean;
  /** Human-readable one-liner. Drivers may surface as primary
   *  content (MCP) or status message (CLI). */
  summary?: string;
  /** Structured payload. JSON-serializable by convention; non-
   *  serializable shapes (Uint8Array, circular refs) are a tool
   *  bug. */
  data?: Data;
  /** Exit code for process-shaped tool calls (`bash`, `npm
   *  install`, `node verify.ts`). Undefined for tools that don't
   *  model exit codes (`read`, `write`, `git_*`).
   *
   *  Drivers use this idiom for the canonical "failed" check:
   *    `result.exitCode === undefined ? !result.ok : result.exitCode !== 0`
   *
   *  Hoisted out of `data` based on convergent feedback from the
   *  three driver spikes (C.1/C.2/C.3). */
  exitCode?: number;
}

// ── Tool schema ──────────────────────────────────────────────────────────

/**
 * Minimal JSON-Schema-shaped input descriptor. Compatible with what
 * the agent SDK and the MCP server expect when registering tools.
 * The structural type means Layer 2 doesn't pull in `ajv` or
 * `json-schema`.
 *
 * Drivers may attach richer validation; Layer 2 itself runs no
 * input validation — tools validate their own args. The schema is
 * declarative, for the LLM (or human) to read.
 */
export interface PieboxToolSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: readonly string[];
}

// ── Tool descriptor ──────────────────────────────────────────────────────

/**
 * The unit drivers expose. One PieboxTool can be adapted into an
 * agent ToolHandler, an MCP server Tool, a CLI subcommand, or
 * called directly.
 */
export interface PieboxTool<Args = unknown, Data = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: PieboxToolSchema;

  execute(
    args: Args,
    sandbox: Sandbox,
    signal: AbortSignal,
  ): Promise<PieboxResult<Data>>;

  /**
   * Optional streaming variant. Drivers that care about live output
   * (agent loop, interactive shell) call this instead of `execute`.
   * Drivers that don't (MCP, direct API) ignore it.
   *
   * The returned `PieboxResult` is the final buffered outcome —
   * streaming is additive, not a replacement. The signal handling
   * convention is the same as `execute`.
   */
  executeStreaming?(
    args: Args,
    sandbox: Sandbox,
    signal: AbortSignal,
    onChunk: (text: string, stream: "stdout" | "stderr") => void,
  ): Promise<PieboxResult<Data>>;
}

// ── Toolset ──────────────────────────────────────────────────────────────

/**
 * A bundle of tools the driver receives from piebox.
 *
 * Drivers iterate over `.tools` to enumerate (e.g. to register every
 * tool with their protocol), or `.get(name)` to dispatch a specific
 * call by name. Filtering is "build a new toolset from the filtered
 * array" — the toolset stays cheap and immutable.
 */
export interface PieboxToolset {
  readonly tools: readonly PieboxTool[];
  /** Look up a tool by `tool.name`. O(1) — toolsets are expected
   *  to maintain an internal name index. */
  get(name: string): PieboxTool | undefined;
}

/**
 * Build a toolset from an array of tools. Cheap helper for drivers
 * that compose their own toolset (e.g. a subset of standard tools
 * plus a few custom ones).
 */
export function createToolset(tools: readonly PieboxTool[]): PieboxToolset {
  const index = new Map<string, PieboxTool>();
  for (const t of tools) {
    if (index.has(t.name)) {
      // Two tools with the same name is a programmer error — drivers
      // can't disambiguate. Fail loudly at construction so it's
      // caught at boot, not on first call.
      throw new Error(`duplicate tool name: ${t.name}`);
    }
    index.set(t.name, t);
  }
  return {
    tools,
    get(name) {
      return index.get(name);
    },
  };
}
