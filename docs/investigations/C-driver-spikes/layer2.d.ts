/**
 * Proposed Layer 2 surface for piebox.
 *
 * This .d.ts is the contract that the three driver spikes
 * (agent / mcp / cli) compile against. The spikes are NOT meant to
 * implement piebox today — they are meant to fall-through-on-compile
 * any time the contract is missing something. Each compile failure
 * is a Layer 2 requirement we hadn't anticipated.
 *
 * Informed by:
 *   - A-codebase-audit.md (where coupling lives today, what
 *     ToolHandler/ToolContext currently look like)
 *   - E-capabilities.md (the seven-field RuntimeCapabilities)
 *   - portability-review.md (PieboxFS / PieboxRuntime structural
 *     types — re-stated here as plain interfaces so spikes don't
 *     have to depend on the live piebox/browser entry)
 *
 * NOT informed yet by:
 *   - B-mcp-prototype.md (blocked). The MCP spike will reveal where
 *     this contract falls short for the MCP driver specifically.
 *
 * No implementation lives in this file. Pure interface.
 */

// ─────────────────────────────────────────────────────────────────────
// Substrate (Layer 1)
// ─────────────────────────────────────────────────────────────────────

/**
 * Stat-like object compatible with what `node:fs`'s sync API returns.
 * Trimmed to the fields piebox operations actually use.
 */
export interface PieboxFsStats {
  isFile(): boolean;
  isDirectory(): boolean;
  size: number;
  mtimeMs: number;
}

export interface PieboxFsDirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export type PieboxFsEncoding = "utf-8" | "utf8" | "ascii" | "latin1";

export interface PieboxFsWriteOptions {
  encoding?: PieboxFsEncoding;
}

export interface PieboxFsMkdirOptions {
  recursive?: boolean;
}

/**
 * In-memory or real filesystem the sandbox operates against.
 * Stays structurally compatible with the existing `PieboxFS` so the
 * refactor doesn't break consumers, but is re-stated here so the
 * spikes don't need to import from `piebox/browser`.
 */
export interface PieboxFS {
  existsSync(path: string): boolean;
  statSync(path: string): PieboxFsStats;
  lstatSync(path: string): PieboxFsStats;
  realpathSync(path: string): string;
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: PieboxFsEncoding): string;
  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): PieboxFsDirent[];

  writeFileSync(
    path: string,
    data: string | Uint8Array,
    options?: PieboxFsWriteOptions,
  ): void;
  mkdirSync(path: string, options?: PieboxFsMkdirOptions): void;
  unlinkSync(path: string): void;
  rmdirSync(path: string): void;
  renameSync(from: string, to: string): void;
  copyFileSync(src: string, dest: string): void;

  appendFileSync?(
    path: string,
    data: string | Uint8Array,
    options?: PieboxFsWriteOptions,
  ): void;
  readlinkSync?(path: string): string;
  symlinkSync?(target: string, path: string): void;
}

export interface PieboxRunOptions {
  cwd?: string;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /** Environment overlay. Merged on top of substrate defaults. */
  env?: Record<string, string>;
}

export interface PieboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PieboxRuntime {
  /** Static description of what this runtime can do.
   *  See `RuntimeCapabilities` below. */
  readonly capabilities: RuntimeCapabilities;

  run(cmd: string, options?: PieboxRunOptions): Promise<PieboxRunResult>;
  getServerUrl?(port: number): string | null;
  sendInput?(data: string): void;
}

/**
 * Seven-field capability snapshot. Validated by investigation E
 * against operations × drivers. See `E-capabilities.md` for the
 * justification per field.
 */
export interface RuntimeCapabilities {
  fileSystem: "vfs" | "os";
  processModel: "shim" | "real";
  realNetwork: boolean;
  nativeAddons: boolean;
  availableBinaries: readonly string[];
  interactiveTty: boolean;
  persistence: "session" | "durable";
}

// ─────────────────────────────────────────────────────────────────────
// Sandbox primitive (Layer 2)
// ─────────────────────────────────────────────────────────────────────

/**
 * The unit drivers operate on. Owned by exactly one driver at a
 * time (or directly by user code). Multi-writer sandboxes are not
 * supported in the MVP; concurrency is the driver's responsibility.
 *
 * Workflow surfaces (toTarball, toGitPack, applyPatch) live on the
 * sandbox itself because they operate on the substrate, not on any
 * particular driver's data model.
 */
export interface Sandbox {
  readonly id: string;
  readonly fs: PieboxFS;
  readonly runtime: PieboxRuntime;
  /** The default working directory for tool calls. May be overridden
   *  per-call via the `cwd` option in `runtime.run`. */
  readonly cwd: string;

  /** Pack `cwd` plus any `.git` into a gzipped tarball. Universal
   *  output format — agent runs can be shipped to a PR, a gist,
   *  S3, or another sandbox. */
  toTarball(options?: ToTarballOptions): Promise<Uint8Array>;

  /** A standalone git pack-file for whatever's in `cwd/.git`.
   *  Smaller than `toTarball` when the workspace has many files
   *  but few changes; suitable for "send me just the commits".  */
  toGitPack(options?: ToGitPackOptions): Promise<Uint8Array>;

  /** Apply a unified-diff patch into `cwd`. Used when a sibling
   *  sandbox produced changes and we want to replay them here. */
  applyPatch(patch: string, options?: ApplyPatchOptions): Promise<void>;

  /** Subscribe to lifecycle events. Returns a disposer.
   *
   *  REVISION (post-spikes): added because C.1 (agent driver) and
   *  C.2 (MCP driver) both flagged "what happens to a sandbox across
   *  multiple submit calls" as ambiguous. The agent driver expects
   *  the sandbox to outlive a single submit; the MCP driver wants
   *  to notify clients via `notifications/resources/list_changed`
   *  when a sandbox dies. One hook covers both. */
  on(event: SandboxEvent, handler: () => void): { dispose(): void };

  /** Stop all in-flight tool calls (best-effort abort via signals),
   *  fire any registered 'destroyed' handlers, free handles.
   *  Idempotent.
   *
   *  REVISION (post-spikes): abort semantics tightened. Tools that
   *  honor their AbortSignal will return shortly after destroy.
   *  Tools that don't honor it may leak — that's a tool bug, not a
   *  sandbox concern. Drivers should not assume in-flight calls
   *  resolve before destroy returns; await them explicitly if
   *  ordering matters. */
  destroy(): void;
}

/** Sandbox lifecycle events. Kept small; new ones land here only
 *  when a real driver needs them (see investigation D's principle:
 *  no events without consumers). */
export type SandboxEvent = "destroyed";

export interface CreateSandboxOptions {
  fs: PieboxFS;
  runtime: PieboxRuntime;
  /** Defaults to `/work`. */
  cwd?: string;
  /** Optional id for the sandbox; one is generated if absent. */
  id?: string;
}

/**
 * Factory. Drivers never new-up sandbox state directly; everything
 * goes through here so the substrate has a single mount point.
 */
export function createSandbox(options: CreateSandboxOptions): Sandbox;

export interface ToTarballOptions {
  /** Glob patterns to exclude. Defaults to `['node_modules/**', '.git/objects/pack/**']`. */
  exclude?: readonly string[];
  /** Compression level 1-9. Default 6. */
  compressionLevel?: number;
}

export interface ToGitPackOptions {
  /** Limit pack to commits reachable from this ref. Default HEAD. */
  ref?: string;
}

export interface ApplyPatchOptions {
  /** Three-way merge when the base differs. Default false (strict). */
  threeWay?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Tool descriptor (Layer 2)
// ─────────────────────────────────────────────────────────────────────

/**
 * Protocol-neutral result every tool returns. Drivers adapt to
 * their own conventions:
 *   - agent SDK: `ok`/`summary`/`data` already match
 *   - MCP: `summary` → `Content[]` text; `ok === false` OR `exitCode !== 0` → isError
 *   - CLI: `exitCode` shows in `[exit N]` line; `data` → stdout JSON; `summary` → human prose
 *
 * REVISION (post-spikes): `exitCode` was hoisted out of `data` based on
 * convergent feedback from C.1, C.2, C.3 — all three spikes either
 * lost fidelity or had to duck-type `data.exitCode`. Bash-shaped tools
 * always set it; non-process tools (read/write/edit) leave it
 * undefined. Drivers branch on `exitCode !== undefined && !== 0`.
 */
export interface PieboxResult<Data = unknown> {
  ok: boolean;
  summary?: string;
  data?: Data;
  /** Exit code for process-shaped tool calls (`bash`, npm install,
   *  `node verify.ts`). Undefined for tools that don't model exit
   *  codes (`read`, `write`, `git_*` etc.). Drivers use
   *  `exitCode === undefined ? !ok : exitCode !== 0` as the
   *  canonical "tool failed" check. */
  exitCode?: number;
}

/**
 * Minimal JSON-Schema-shaped input descriptor. Compatible with what
 * both the agent SDK and the MCP server expect when registering
 * tools. The structural type means we don't pull in `ajv` or
 * `json-schema` packages at this layer.
 */
export interface PieboxToolSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: readonly string[];
}

/**
 * The unit of "thing a driver can expose." One PieboxTool can be
 * adapted into an agent ToolHandler, an MCP server Tool, a CLI
 * subcommand, or called directly.
 *
 * `execute` is intentionally lean — no agent-SDK ToolContext, no
 * workspace, no driver-shaped runtime. The sandbox and the signal
 * are everything a tool needs to do useful work.
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
   * (agent, shell) call this instead of `execute`. Drivers that
   * don't (MCP, direct API) ignore it.
   *
   * The argument convention is the same as `execute` plus
   * `onChunk(text, stream)` where `stream` is `'stdout' | 'stderr'`.
   * The returned `PieboxResult` is the final buffered outcome —
   * streaming is additive, not a replacement.
   */
  executeStreaming?(
    args: Args,
    sandbox: Sandbox,
    signal: AbortSignal,
    onChunk: (text: string, stream: "stdout" | "stderr") => void,
  ): Promise<PieboxResult<Data>>;
}

/**
 * A bundle of tools the driver receives from piebox. The driver
 * iterates over `.tools` to enumerate, or `.get(name)` to dispatch
 * by name. Filtering (only expose a subset) is fine — just call
 * `createStandardToolset` then construct a new toolset from
 * `.tools.filter(...)` plus a fresh name index.
 *
 * REVISION (post-spikes): `.get(name)` was added based on
 * convergent feedback from C.1 (agent dispatch) and C.3 (CLI
 * command lookup). Both spikes built local `Map<string, PieboxTool>`
 * adapters; the toolset should own that index since tool names are
 * authoritative there. Avoids three slightly-different lookup
 * helpers across drivers.
 */
export interface PieboxToolset {
  readonly tools: readonly PieboxTool[];
  get(name: string): PieboxTool | undefined;
}

/**
 * Standard toolset factory — wires the canonical operations
 * (read/write/edit/bash/ls/grep/find + git_*) over a sandbox.
 * Drivers that want a different set can compose their own.
 */
export function createStandardToolset(sandbox: Sandbox): PieboxToolset;
