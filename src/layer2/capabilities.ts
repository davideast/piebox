/**
 * Runtime capability fingerprint.
 *
 * Seven fields, validated by investigation E
 * (`docs/investigations/E-capabilities.md`) against the matrix of
 * operations × drivers. Each field has at least one real consumer:
 * either an operation that branches on the value, or a driver that
 * templates the value into a system prompt / tool catalog.
 *
 * Capabilities describe the runtime — they're declarative truth, not
 * runtime state. A sandbox's fingerprint is set at construction
 * time and doesn't change for the lifetime of the sandbox.
 *
 * See `docs/investigations/E-capabilities.md` for the per-field
 * rationale.
 */

export interface RuntimeCapabilities {
  /** 'vfs' = in-memory tree (almostnode browser, almostnode-node-mode).
   *  'os'  = real host filesystem. */
  fileSystem: "vfs" | "os";

  /** 'shim' = command goes through almostnode's bundled just-bash;
   *           substrate translators (npm create, node -e, devDeps
   *           backstop) are needed.
   *  'real' = command spawns a host OS process; translators no-op. */
  processModel: "shim" | "real";

  /** Can a process inside the sandbox open real TCP/UDP sockets?
   *  False in browsers (only `fetch()` plus the Service-Worker
   *  bridge). True for trusted-Node, configurable for sandboxed-
   *  Node. */
  realNetwork: boolean;

  /** Can `npm install` build and load C++ native addons? False on
   *  all browser paths; usually true on Node paths. */
  nativeAddons: boolean;

  /** Real binaries reachable via the runtime's PATH. Empty for
   *  almostnode; populated lists let the system prompt advertise
   *  specifically what's available (`git`, `curl`, `python`, ...). */
  availableBinaries: readonly string[];

  /** Does `runtime.run` emulate a TTY (cursor positioning, raw
   *  mode, signal forwarding)? Programs like `vim`, `top`, raw
   *  `node` REPLs need this. Typically false on shim runtimes. */
  interactiveTty: boolean;

  /** Whether the in-sandbox filesystem persists across runtime
   *  restarts. 'session' = lost on tab close or process exit.
   *  'durable' = IndexedDB / real disk. */
  persistence: "session" | "durable";
}

// ── Preset fingerprints ───────────────────────────────────────────────────
// Convenience constants for the common substrate shapes. Use as the
// starting point and override the fields that differ for your setup
// (e.g. sandboxed-Node with limited binaries).

/** Browser substrate (almostnode). Empty $PATH, no real network, no
 *  native addons, no TTY. */
export const BROWSER_CAPABILITIES: RuntimeCapabilities = Object.freeze({
  fileSystem: "vfs",
  processModel: "shim",
  realNetwork: false,
  nativeAddons: false,
  availableBinaries: Object.freeze([]) as readonly string[],
  interactiveTty: false,
  persistence: "session",
});

/** Trusted-Node substrate (real child_process, real disk). Real
 *  network and native addons enabled by default; the caller should
 *  refine `availableBinaries` to reflect the actual host. */
export const NODE_CAPABILITIES: RuntimeCapabilities = Object.freeze({
  fileSystem: "os",
  processModel: "real",
  realNetwork: true,
  nativeAddons: true,
  availableBinaries: Object.freeze(["git", "curl"]) as readonly string[],
  interactiveTty: true,
  persistence: "durable",
});
