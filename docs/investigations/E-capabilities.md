# Investigation E — Capability Matrix

> Turn the portability review's rough `capabilities` proposal into a
> concrete enum, validated by enumerating which operations and
> drivers actually branch on it. If any field doesn't have a real
> consumer, it shouldn't exist.

## The proposed capabilities type

After enumerating both sides of the matrix (below) the smallest set
that covers every branching code path piebox would plausibly emit
is **seven fields**:

```ts
/**
 * Static, declarative description of what a runtime can do.
 *
 * Designed to satisfy three consumer patterns:
 *   1. Operations that BRANCH on capability (bash applies translators
 *      only when `processModel === 'shim'`).
 *   2. Drivers that TEMPLATE capabilities into a system prompt or
 *      tool catalog (agent + MCP both do this).
 *   3. Drivers that BRANCH on capability (CLI uses different tarball
 *      extraction code for `fileSystem === 'os'` vs `'vfs'`).
 *
 * Not modeled here: dynamic runtime state (e.g. "are we currently
 * inside a request"). That belongs on the Sandbox primitive.
 */
interface RuntimeCapabilities {
  /** 'vfs' = in-memory tree (almostnode browser, almostnode-node-mode).
   *  'os'  = real host filesystem. */
  fileSystem: 'vfs' | 'os';

  /** 'shim' = command goes through almostnode's bundled just-bash;
   *           the substrate-translator stack (npm create, node -e,
   *           devDeps backstop) is needed.
   *  'real' = command spawns a host OS process; translators are
   *           no-ops. */
  processModel: 'shim' | 'real';

  /** Can a process inside the sandbox open real TCP/UDP sockets?
   *  False in browsers (only `fetch()` plus the Service-Worker
   *  bridge). True for trusted-Node, configurable for sandboxed-
   *  Node. Affects: postgres/redis/mongo clients, custom protocol
   *  servers, what the agent system prompt advertises. */
  realNetwork: boolean;

  /** Can `npm install` build and load C++ native addons (sharp,
   *  better-sqlite3, sqlite-vec, canvas, ...)? False on all browser
   *  paths; usually true on Node paths unless explicitly disabled. */
  nativeAddons: boolean;

  /** Real binaries reachable via the runtime's PATH. Empty for
   *  almostnode (only its bundled shims). Populated lists let the
   *  system prompt advertise specifically what's available
   *  (`git`, `curl`, `python`, `make`, `gh`, ...). */
  availableBinaries: readonly string[];

  /** Does `runtime.run` emulate a TTY (cursor positioning, raw mode,
   *  signal forwarding)? False for almostnode shim — programs like
   *  `vim`, `top`, `less`, raw `node` REPLs do not work. Mostly true
   *  on real-Node spawn paths. */
  interactiveTty: boolean;

  /** Whether the in-sandbox filesystem persists across runtime
   *  restarts. 'session' = lost on tab close or process exit.
   *  'durable' = IndexedDB in browser, real disk on server.
   *  Branched on by session-pool drivers that want to checkpoint. */
  persistence: 'session' | 'durable';
}
```

Notes on what's deliberately *not* in this type:

- **No `gpuAccess` / `wasmThreads` / `sharedArrayBuffer` etc.** —
  these are real things a sandbox could expose, but no operation or
  driver currently in scope branches on them. Add when a real branch
  appears.
- **No `maxMemoryMB` / `maxProcessTime`** — these are quotas, not
  capabilities. They belong on a different type (e.g.
  `RuntimeLimits`) consumed by drivers, not by tools.
- **No `version` / `userAgent`** — telemetry, not capability. Belongs
  in a separate metadata surface.
- **No `kind: 'browser' | 'node'`** — captured indirectly via the
  combination of `fileSystem` and `processModel`. A consumer that
  wants "is this browser-ish" can compute it. Adding the field would
  invite drivers to branch on `kind` instead of on the actual
  capability they care about (anti-pattern).

## Table 1 — operation × capability

Cells:
- **R** = required (operation cannot function without this capability at the assumed value)
- **B** = branches (operation reads the value and changes behavior)
- **—** = not used

| Operation                          | fileSystem | processModel | realNetwork | nativeAddons | availableBinaries | interactiveTty | persistence |
| ---------------------------------- | ---------- | ------------ | ----------- | ------------ | ----------------- | -------------- | ----------- |
| `read` / `write` / `edit`          | R          | —            | —           | —            | —                 | —              | —           |
| `ls` / `grep` / `find`             | R          | —            | —           | —            | —                 | —              | —           |
| `bash` (raw passthrough)           | R          | R            | —           | —            | —                 | B*             | —           |
| `runInSandbox` (bash + translators)| R          | B            | —           | B            | B                 | B*             | —           |
| `git_init` / `git_status` / etc.   | R          | —            | —           | —            | —                 | —              | —           |
| `toTarball` / `toGitPack`          | R          | —            | —           | —            | —                 | —              | —           |
| `applyPatch`                       | R          | —            | —           | —            | —                 | —              | —           |

\* `bash` doesn't branch *internally* on `interactiveTty` but its
caller might. The flag exists so the shell driver and interactive
tools know whether to expect cursor-positioning escape sequences to
work end-to-end.

### Observations from Table 1

1. **`fileSystem` is universal** — every operation needs it, no
   operation branches on `'vfs'` vs `'os'`. This means the FIELD
   has value (drivers care) but operations don't read it directly.
   Confirms the choice to keep operations on the `PieboxFS`
   abstraction rather than threading capability through them.

2. **`processModel` is `bash`-only** — only the bash family of
   operations cares. `runInSandbox` branches because the translators
   (npm create, node -e, devDeps backstop) only fire when
   `processModel === 'shim'`. On `'real'` they no-op.

3. **`realNetwork`, `nativeAddons`, `availableBinaries`** are
   touched by `runInSandbox` for advisory purposes (deterministic
   hint generation, e.g. "Cannot find module" → "you need
   `npm install ...`"). The translators can warn earlier when a
   command needs network or a missing binary.

4. **Most of the matrix is empty.** That's expected and good — pure
   operations should NOT branch on substrate capabilities. The
   capability type exists for the *drivers*, not the *operations*.

## Table 2 — driver × capability

Cells:
- **T** = templates the value (e.g. embeds in system prompt or tool catalog)
- **B** = branches on the value (code paths differ)
- **—** = ignores

| Driver         | fileSystem | processModel | realNetwork | nativeAddons | availableBinaries | interactiveTty | persistence |
| -------------- | ---------- | ------------ | ----------- | ------------ | ----------------- | -------------- | ----------- |
| **agent**      | T          | T            | T           | T            | T                 | —              | T           |
| **mcp**        | T          | T            | T           | T            | T                 | —              | T           |
| **cli (shell)**| B          | B            | —           | —            | —                 | B              | —           |
| **direct API** | —          | —            | —           | —            | —                 | —              | —           |
| **session pool** (proposed) | B | B | — | — | — | — | B |

### Observations from Table 2

1. **The agent and MCP drivers are almost identical** in their
   capability consumption: both want a complete picture to template
   into prompts and tool catalogs. This validates the previous
   recommendation to define them as parallel drivers consuming the
   same Layer 2 (with different transports/protocols).

2. **`interactiveTty` is consumed by the CLI driver only.** Agent
   and MCP drivers don't surface TTY-shaped affordances to their
   clients. This suggests `interactiveTty` is a candidate for
   driver-specific configuration rather than a global capability —
   IF the shell driver is the only consumer. Keeping it on
   `RuntimeCapabilities` is still defensible because (a) it's
   declarative truth about the runtime regardless of who reads it,
   and (b) a future "agent that drives a TUI" driver would consume
   it. Marginal cost; leave it in.

3. **Direct API ignores everything.** Users calling
   `sandbox.read(...)` directly don't need capability awareness.
   This validates that no operation requires capability lookup —
   if it did, the direct API would have to inject capabilities.

4. **Session pool branches on `fileSystem` and `persistence`** —
   checkpoint strategies differ for VFS-tree vs OS-real, and
   persistence determines whether the pool can resume across
   restarts. This is the strongest single-purpose use of these two
   fields.

## Substrate fingerprints

How the four target substrates fill out `RuntimeCapabilities`:

| Field              | Browser (almostnode fork) | Trusted Node (real)      | Sandboxed Node (jail)              | Almostnode-on-Node (hypothetical) |
| ------------------ | ------------------------- | ------------------------ | ---------------------------------- | --------------------------------- |
| fileSystem         | `'vfs'`                   | `'os'`                   | `'os'`                             | `'vfs'`                           |
| processModel       | `'shim'`                  | `'real'`                 | `'real'`                           | `'shim'`                          |
| realNetwork        | `false`                   | `true`                   | configurable                       | `false`                           |
| nativeAddons       | `false`                   | `true`                   | configurable                       | `false`                           |
| availableBinaries  | `[]`                      | host-`$PATH` snapshot    | jail's contents                    | `[]`                              |
| interactiveTty     | `false`                   | `true`                   | usually `true`                     | `false`                           |
| persistence        | `'session'` (or `'durable'` if IndexedDB-backed) | `'durable'` | configurable | `'session'`                       |

The hypothetical "almostnode on Node" column matters: it would let
the same sandbox primitive be tested in CI against the same
constraints as the browser (no network, no native modules, vfs only)
without spinning up a real browser. The capability fingerprint of
this combination is unique and tractable.

## What this resolves in the parent plan

- **D2 (tool descriptor shape):** confirms the descriptor needs only
  `sandbox + args + signal`, not a capability object — operations
  that *do* branch on capabilities read `sandbox.runtime.capabilities`
  themselves. The descriptor shape stays small.
- **D5 (Layer 2 sufficiency for streaming):** out of scope for E.
  Handled by D.
- **D7 (boundary enforcement):** consistent with F's grep approach.
  `RuntimeCapabilities` is a plain type; no enforcement required
  beyond standard import bans.

## Open questions surfaced (for later investigations)

1. **Should `availableBinaries` be a `Set<string>` or `readonly string[]`?**
   For lookup ergonomics, `Set` wins. For JSON serialization (system
   prompt), arrays win. Pick during the refactor based on the most
   common access pattern — probably a `Set` internally with a
   serializer for the prompt template.

2. **Is `persistence: 'session' | 'durable'` enough granularity?**
   IndexedDB-backed VFS might be "durable per-tab" but disappears
   on cache clear. Real disk is "durable until something deletes it."
   These are different enough that a third value might land later
   (`'session' | 'cache' | 'disk'`). Defer until a consumer actually
   branches on the distinction.

3. **Does the agent driver template the capabilities into the system
   prompt at session start, or at each turn?** The fingerprint
   doesn't change mid-session unless the runtime is swapped, so once
   per session is fine. Document this in `@piebox/driver-agent`.

## Acceptance criteria

- [x] Concrete `RuntimeCapabilities` type with rationale per field.
- [x] Table 1 (operation × capability) with required/branches/not-used cells.
- [x] Table 2 (driver × capability) with templates/branches/ignores cells.
- [x] Substrate fingerprints for the four expected runtimes.
- [x] Each field has at least one real consumer; no speculative fields.
- [x] Open questions captured but not deferred indefinitely.

All met. E is closed pending validation against C (driver spikes will
either confirm the cells in Table 2 or surface missing fields).
