/**
 * Layer 2 Sandbox primitive.
 *
 * The unit drivers (agent loop, MCP server, CLI, direct API) operate
 * on. Owned by one driver at a time — multi-writer sandboxes are not
 * supported in the MVP; the driver is responsible for serializing
 * tool calls.
 *
 * Workflow surfaces (`toTarball`, `toGitPack`, `applyPatch`) live on
 * the sandbox itself because they operate on the substrate, not on
 * any particular driver's data model. The bare minimum for Step 3
 * is `toTarball`; the other two are stubbed with explicit
 * "not yet implemented" errors to make their absence loud rather
 * than silent — see `docs/investigations/G-migration.md`.
 */

import type { PieboxFS } from "../fs/types.js";
import type { PieboxRuntime } from "../runtime/types.js";
import type { RuntimeCapabilities } from "./capabilities.js";
import { vfsToTarball } from "./tarball.js";

// ── Public types ─────────────────────────────────────────────────────────

/** Events the sandbox emits over its lifetime. Intentionally narrow
 *  — investigation D's "no events without consumers" principle
 *  means a new kind lands only when a real driver demands it. */
export type SandboxEvent = "destroyed";

export interface SandboxToTarballOptions {
  /** Glob-shaped exclude list. Defaults to `node_modules` and
   *  `.git/objects/pack`. */
  exclude?: readonly string[];
  /** Gzip compression level 1-9. Default 6. */
  compressionLevel?: number;
}

export interface SandboxToGitPackOptions {
  /** Limit pack to commits reachable from this ref. Default HEAD. */
  ref?: string;
}

export interface SandboxApplyPatchOptions {
  /** Three-way merge when the base differs. Default false (strict). */
  threeWay?: boolean;
}

export interface Sandbox {
  readonly id: string;
  readonly fs: PieboxFS;
  readonly runtime: PieboxRuntime;
  /** The default cwd for tool calls. Tools that need a different
   *  working directory pass it explicitly via their args. */
  readonly cwd: string;
  /** Capability fingerprint. Set at construction; doesn't change
   *  for the sandbox's lifetime. Drivers branch on these values
   *  for system prompts, advisory hints, and protocol mapping. */
  readonly capabilities: RuntimeCapabilities;

  /** Pack `cwd` (plus any `.git`) into a gzipped POSIX-ustar
   *  tarball. Universal output format — agent runs can be shipped
   *  to a PR, a gist, S3, or another sandbox. */
  toTarball(options?: SandboxToTarballOptions): Promise<Uint8Array>;

  /** Standalone git pack-file. Smaller than `toTarball` when the
   *  workspace has many files but few changes; suitable for
   *  "send me just the commits."
   *
   *  Not yet implemented — wires into isomorphic-git's pack writer
   *  in a follow-up step. */
  toGitPack(options?: SandboxToGitPackOptions): Promise<Uint8Array>;

  /** Apply a unified-diff patch into `cwd`. Used when a sibling
   *  sandbox produced changes and we want to replay them here.
   *
   *  Not yet implemented — wires into isomorphic-git's patch
   *  apply in a follow-up step. */
  applyPatch(patch: string, options?: SandboxApplyPatchOptions): Promise<void>;

  /** Subscribe to lifecycle events. Returns a disposer. The
   *  `'destroyed'` event fires exactly once on the first
   *  `destroy()` call; subsequent destroys are no-ops. */
  on(event: SandboxEvent, handler: () => void): { dispose(): void };

  /** Stop all in-flight tool calls (best-effort abort via the
   *  signal passed to each `tool.execute`), fire any registered
   *  'destroyed' handlers exactly once, then free handles.
   *  Idempotent — calling twice is safe.
   *
   *  Tools that honor their AbortSignal return shortly after
   *  destroy. Tools that don't honor it may leak — that's a tool
   *  bug, not a sandbox concern. Drivers that need ordered
   *  shutdown should await their tool calls explicitly before
   *  calling destroy(). */
  destroy(): void;
}

export interface CreateSandboxOptions {
  fs: PieboxFS;
  runtime: PieboxRuntime;
  capabilities: RuntimeCapabilities;
  /** Defaults to `/work` (the convention shared with the agent
   *  driver and the playground). */
  cwd?: string;
  /** Optional id for the sandbox; auto-generated if absent. */
  id?: string;
}

// ── Factory ──────────────────────────────────────────────────────────────

let sandboxCounter = 0;

export function createSandbox(options: CreateSandboxOptions): Sandbox {
  const id =
    options.id ??
    `sb-${++sandboxCounter}-${Date.now().toString(36)}`;
  const cwd = options.cwd ?? "/work";
  const fs = options.fs;
  const runtime = options.runtime;
  const capabilities = options.capabilities;

  const handlers = new Set<() => void>();
  // Abort controllers for in-flight tool calls — drivers can call
  // `sandbox.destroy()` to abort everything at once. The actual
  // signal-distribution happens inside the standard toolset; this
  // controller is the parent everyone descends from.
  let destroyed = false;

  return {
    id,
    fs,
    runtime,
    cwd,
    capabilities,

    async toTarball(opts) {
      if (destroyed) throw new Error("sandbox destroyed");
      return vfsToTarball(fs, {
        root: cwd,
        ...(opts?.exclude !== undefined ? { exclude: opts.exclude } : {}),
        ...(opts?.compressionLevel !== undefined
          ? { compressionLevel: opts.compressionLevel }
          : {}),
      });
    },

    async toGitPack(_opts) {
      if (destroyed) throw new Error("sandbox destroyed");
      throw new Error(
        "Sandbox.toGitPack: not yet implemented (Step 3 ships toTarball; " +
          "git-pack ships once the isomorphic-git pack writer is wired into " +
          "Layer 2 — see G-migration.md follow-ups).",
      );
    },

    async applyPatch(_patch, _opts) {
      if (destroyed) throw new Error("sandbox destroyed");
      throw new Error(
        "Sandbox.applyPatch: not yet implemented (ships alongside toGitPack " +
          "— same dependency on isomorphic-git wiring).",
      );
    },

    on(event, handler) {
      // Today the only event is 'destroyed'; the narrow type is
      // already enforced. We still keep the dispatch generic so
      // adding kinds later doesn't require an API change.
      if (event !== "destroyed") {
        // No-op for unknown events — gives forward compatibility if
        // a driver checks for an event piebox doesn't emit yet.
        return { dispose: () => undefined };
      }
      handlers.add(handler);
      return {
        dispose: () => {
          handlers.delete(handler);
        },
      };
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      const snapshot = Array.from(handlers);
      handlers.clear();
      for (const h of snapshot) {
        try {
          h();
        } catch {
          // A misbehaving handler shouldn't block subsequent ones.
        }
      }
    },
  };
}
