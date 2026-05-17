# Investigation G — Migration Plan

> Synthesizes A–F into a sequenced refactor. Six numbered steps, each
> shippable on its own, each reversible. The boundary-test going green
> is the last step.

## 1. Goal recap

The end state is the three-layer separation laid out in
[composable-sandbox.md](../explanation/composable-sandbox.md): a
Layer 1 substrate (`PieboxFS` + `PieboxRuntime` + `RuntimeCapabilities`)
sitting under a Layer 2 capability surface (sandbox primitive +
piebox-native operation types + `PieboxTool` descriptor +
`PieboxToolset` + workflow helpers), with drivers (`@piebox/driver-agent`,
`@piebox/driver-mcp`, plus a still-experimental CLI) layered on top.

The C-spike synthesis ([SYNTHESIS.md](C-driver-spikes/SYNTHESIS.md))
validated that three drivers compile cleanly against
[layer2.d.ts](C-driver-spikes/layer2.d.ts) with no `any` casts after
four small revisions (`exitCode`, `toolset.get`, `Sandbox.on`,
abort semantics). D ([D-streaming.md](D-streaming.md)) concluded
streaming stays as the existing optional
`PieboxTool.executeStreaming(args, sandbox, signal, onChunk)` —
no `PieboxEvent` union in core. E ([E-capabilities.md](E-capabilities.md))
locked in the seven-field `RuntimeCapabilities` shape that
`PieboxRuntime` exposes.

What the refactor *moves*: 16 files in `src/` that import
`@earendil-works/pi-coding-agent` get re-typed against piebox-native
operation types, and the agent-loop scaffolding (`src/session.ts`,
the bulk of `src/sandbox.ts`'s `createSession` path) moves into a
new `@piebox/driver-agent` package. The 2 files in
`examples/browser/src/` that import `@inbrowser/agent` get rewritten
against `@piebox/driver-agent`. A new `@piebox/driver-mcp` package
gets scaffolded.

What the refactor *keeps*: the existing `PieboxFS` / `PieboxRuntime`
interfaces and the `createBrowserFs` / `createBrowserRuntime` factories
(portability work landed before C started). The `executeStreaming`
shape stays. `Bash` / `just-bash` stays — but bash becomes the
default `PieboxRuntime` rather than a sibling capability the bash
tool reaches into directly (per portability review §5 step 2).

The migration is the final deliverable of the planning phase. After
G commits, code can move; before G commits, code stays put.

## 2. Pre-flight checks

What needs to be true before Step 1 starts. Each is small; none is
a refactor.

1. **`scripts/investigations/boundary-test.sh` promoted to `scripts/`.**
   F documented the promotion criteria (G committed + first step lands
   + CI wired). G being committed satisfies criterion 1; Step 1 satisfies
   criterion 2; Step 1's PR also wires CI. So promotion is a small
   per-step task, not pre-flight. **Pre-flight action:** confirm the
   script's `BANNED_FROM_CORE` list still matches the audit and adjust
   if the user has changed dependencies since A ran.

2. **CI runner has bash 4+ and grep.** GitHub Actions ubuntu-latest does;
   no setup needed. Document the dependency in
   `scripts/investigations/boundary-test.sh`'s header comment when it
   moves.

3. **Two npm packages reserved in the workspace.** This refactor creates
   `@piebox/driver-agent` and `@piebox/driver-mcp`. Both live as new
   directories under `packages/` (introducing a packages/ layout if the
   repo is not already a workspace), and both are private/unpublished
   for the duration of the refactor. Publish only after Step 5 (driver-
   agent) and Step 6 (driver-mcp) land and pass smoke tests.

4. **B (MCP prototype postmortem) status acknowledged.** B is BLOCKED on
   the prototype landing on this machine. G plans for the MCP driver
   anyway. If B unblocks during the refactor, **Step 5** is the step
   most likely to need revision — specifically the `@piebox/driver-mcp`
   scaffolding's lifecycle and resource shape. The default assumption
   below is "single-sandbox-per-driver, capabilities-as-MCP-resource,
   no per-tool annotations." B's data would either confirm or replace
   those defaults.

5. **A test environment for the MCP smoke test.** Step 5's exit criteria
   include "Claude Desktop loads `@piebox/driver-mcp` over stdio and
   list-tools succeeds." A workstation with Claude Desktop installed,
   or an equivalent MCP host (Cursor, `mcp-inspector`), is required.
   Not a blocker for any earlier step.

6. **One open question that gates the refactor:** the user must decide
   whether the published `@piebox/driver-agent` adapts to
   `@earendil-works/pi-coding-agent` (the server-side SDK), to
   `@inbrowser/agent` (the browser SDK), or to both. The audit confirmed
   they're independent shapes; the agent driver spike defined its own
   internal `LlmClient` shape that doesn't match either. **Default
   adopted below:** `@piebox/driver-agent` ships its own
   protocol-neutral `LlmClient` interface (per the C.1 spike) and
   provides two adapters in subpackages or peerDependencies:
   `@piebox/driver-agent/pi-coding-agent` and
   `@piebox/driver-agent/inbrowser-agent`. The user can confirm or
   change before Step 4.

## 3. The numbered steps

### Step 1 — Promote boundary-test, freeze baseline, wire CI

**What changes:**

- Move `scripts/investigations/boundary-test.sh` → `scripts/boundary-test.sh`.
- Add a header comment listing the four banned packages and the
  baseline violation count (21 violations across 16 files — matches
  A's headline).
- Add `.github/workflows/boundary.yml` (or extend an existing CI
  workflow) with one job: `bash scripts/boundary-test.sh`.
- Configure the CI step to **report but not fail** for now (`continue-on-error: true`).
  Trajectory matters; the gate flips to failing in Step 6.
- Commit the current violation count as a JSON baseline file
  (`scripts/boundary-baseline.json`) so subsequent steps can show
  the count going down.

**Why this is first:** zero coupling to other steps; pure tooling.
Lands the trajectory measurement before any code moves so each
subsequent step shows visible progress. Also satisfies F's
promotion criteria 1–3.

**Public API change?** No. (No source files change.)

**Rollback note:** revert the move and delete the workflow file.
Two commands. Investigations directory still has the original
script, so nothing is lost.

**Tests / verification:**
- `bash scripts/boundary-test.sh` exits 1 with the documented baseline
  violation count.
- CI run on the PR posts the violation count as a check (non-failing).
- A deliberately-introduced new banned import (e.g. add
  `import "@earendil-works/pi-coding-agent"` somewhere in `src/`)
  in a throwaway commit increases the count by one. Revert before merging.

---

### Step 2 — Introduce piebox-native operation types

**What changes:**

- Create `src/operations/types.ts` containing piebox-native equivalents
  of the seven operation type aliases that currently come from
  `@earendil-works/pi-coding-agent`:
  - `ReadOperations`
  - `WriteOperations`
  - `EditOperations`
  - `LsOperations`
  - `GrepOperations`
  - `FindOperations`
  - `BashOperations`

  Each is defined structurally to match what the corresponding
  `createXOperations` function in `src/operations/` already returns.
  No behavior changes — these are pure type aliases.

- The new types live alongside the old imports; nothing is deleted.
  Each `src/operations/*.ts` file gets its return type changed from
  `@earendil-works/pi-coding-agent`'s `XOperations` to the new
  `./types.ts`'s `XOperations`. Because the shapes are structurally
  compatible (the operations already satisfy them — that's what
  "implementation lives in piebox" means), the change is
  type-replacement only, not implementation.

- Export the new types from `src/index.ts` under a sub-path
  (`piebox/operations`) so consumers and the driver packages can
  import them without pulling the whole piebox entry.

- `src/tools.ts` is **not** changed in this step — it still imports
  `createXToolDefinition` from `@earendil-works/pi-coding-agent`,
  which takes an `XOperations` argument. Because the piebox-native
  type is structurally compatible, the call site keeps working
  unchanged.

**Why this is second:** leaf change, no dependents. Lets Step 3 and
later type their substrate work against piebox-native shapes instead
of the SDK shapes, and it's reversible by deleting `types.ts` and
flipping seven imports back. The boundary-test count goes **down by 7**
(7 fewer files in `src/operations/` import the SDK as a type).

**Public API change?** No — additive. The new types ship under
a new entry path; the old paths still re-export from the SDK.

**Rollback note:** delete `src/operations/types.ts`, revert each
`src/operations/*.ts` import back to `@earendil-works/pi-coding-agent`,
remove the re-export from `src/index.ts`. No call-site changes needed.

**Tests / verification:**
- TypeScript compiles cleanly (`tsc --noEmit`).
- `bash scripts/boundary-test.sh` reports 7 fewer violations than the
  Step 1 baseline (was 19 imports of `@earendil-works/pi-coding-agent`,
  becomes 12 once `src/operations/*.ts` no longer imports it for types).
- Add a structural-compatibility test: a Vitest file that imports both
  the piebox-native type and the SDK type and asserts assignability in
  both directions (`const a: SdkRead = pieboxOps; const b: PieboxRead = sdkOps;`).
  Catches future drift.

---

### Step 3 — Introduce Layer 2 sandbox primitive + PieboxTool descriptor

**What changes:**

- Create a new `src/layer2/` directory containing:
  - `src/layer2/sandbox.ts` — `Sandbox`, `createSandbox(options)`,
    `SandboxEvent` (just `"destroyed"`), matching the
    `layer2.d.ts` shape verbatim. Wraps an existing `PieboxFS` +
    `PieboxRuntime`; the body is roughly:

    ```
    function createSandbox({fs, runtime, cwd, id}) {
      const handlers = new Set<() => void>();
      // toTarball/toGitPack/applyPatch wrap existing helpers
      return { id, fs, runtime, cwd, toTarball, toGitPack, applyPatch,
               on: (event, h) => { handlers.add(h); return { dispose: () => handlers.delete(h) } },
               destroy: () => { handlers.forEach(h => h()); } };
    }
    ```

  - `src/layer2/tool.ts` — `PieboxTool<Args, Data>`,
    `PieboxResult<Data>`, `PieboxToolSchema`, `PieboxToolset`,
    `createStandardToolset(sandbox)`. The toolset's `get(name)`
    is a `Map<string, PieboxTool>` indexer (the C.1 + C.3 convergent gap).

  - `src/layer2/capabilities.ts` — re-export `RuntimeCapabilities`
    from `src/runtime/types.ts` if it already lives there; otherwise
    move it. E's seven fields are authoritative.

  - `src/layer2/index.ts` — re-exports everything above.

- `createStandardToolset` wires the existing `createXOperations`
  functions into `PieboxTool` shells. The bodies are thin:

  ```
  const readTool: PieboxTool = {
    name: 'read', description: '...', inputSchema: {...},
    async execute(args, sandbox, signal) {
      const ops = createReadOperations(sandbox.fs);
      const data = await ops.readFile(args.path);
      return { ok: true, summary: `Read ${args.path}`, data };
    }
  };
  ```

  Only `bash` implements `executeStreaming` (using
  `runtime.run`'s `onStdout`/`onStderr` callbacks).

- Add a new top-level entry: `piebox/layer2` in `package.json`'s
  `exports`. This exposes Layer 2 to driver packages without
  pulling in the legacy `session.ts`/agent-SDK surface.

- Nothing in `src/sandbox.ts`, `src/session.ts`, `src/tools.ts`
  is touched in this step. Layer 2 ships **alongside** the current
  surface. Both compile and pass tests.

**Why this is third:** depends on Step 2 (the piebox-native operation
types) for clean wiring. Establishes the seam every later step
relies on. By landing Layer 2 before any driver code moves, we
prove the contract works against the existing operations without
also having to prove the driver migration in the same PR.

The boundary-test count does **not** change in this step — Layer 2
adds new files; `src/operations/` already moved off the SDK in
Step 2; `src/sandbox.ts` and friends still import the SDK.

**Public API change?** Yes — *additive*. New entry point `piebox/layer2`.
The existing `piebox` and `piebox/browser` entries are untouched.

**Rollback note:** delete `src/layer2/` and the `piebox/layer2` entry
in `package.json`. Nothing else references it yet. Single-PR revert.

**Tests / verification:**
- A new `src/layer2/sandbox.test.ts` (Vitest) creates a sandbox over
  an in-memory `PieboxFS` and runs a few tool calls
  (`read`, `write`, `bash`) end-to-end.
- A second test asserts `Sandbox.on('destroyed', h)` fires `h` exactly
  once on `destroy()` and that subsequent `destroy()` calls are
  idempotent (G3 from C).
- A third test asserts `PieboxResult.exitCode` is set by the bash tool
  on non-zero exit, and undefined for non-process tools (G1 from C).
- Type-check: import from `piebox/layer2` in a probe TS file outside
  `src/` and confirm no transitive `@earendil-works/*` symbol leaks
  into the surface (this is a manual one-time check; the boundary
  script will enforce it in Step 6).

---

### Step 4 — Scaffold @piebox/driver-agent, migrate examples/browser to it

**What changes:**

- Create `packages/driver-agent/` with:
  - `package.json` (private until exit), `peerDependencies` on `piebox`.
  - `src/index.ts` — exports `createAgentDriver`, `AgentDriver`,
    `AgentEvent`, `LlmClient`, `defaultSystemPromptBuilder`. Identical
    shape to the C.1 spike at
    [agent-driver.ts](C-driver-spikes/agent-driver.ts).
  - `src/adapters/inbrowser-agent.ts` — thin adapter mapping
    `LlmClient` ⇆ `@inbrowser/agent`'s LLM call surface. This is
    where the actual `@inbrowser/agent` dependency lives, isolated
    from the driver core.
  - `src/adapters/pi-coding-agent.ts` — same, for the server-side
    SDK. May ship empty in this step if the server-side adapter
    isn't needed yet (it isn't until Step 5b, see below).

- Modify `examples/browser/src/agent.ts` and
  `examples/browser/src/agent/useAgentLoop.ts` (the only two files
  in `examples/browser/` that import `@inbrowser/agent`) to instead
  import from `@piebox/driver-agent`:
  - `SessionEvent` → `AgentEvent` (rename; shape matches after dead
    branches `workspace_changed`/`runtime_changed`/`strategy_event`
    are dropped per D).
  - `ToolHandler` definitions → `PieboxTool` definitions, each one
    re-written to use the `(args, sandbox, signal) => PieboxResult`
    shape from Layer 2. The 11 tool definitions enumerated in A
    (`writeTool`, `readTool`, `editTool`, `bashTool`, `lsTool`,
    plus 7 git tools at lines 313–426 of agent.ts) all migrate in
    this step.
  - The agent driver's `submit(prompt, signal)` returns an
    `AsyncIterable<AgentEvent>` — `useAgentLoop.ts`'s switch over
    `event.kind` updates only the type, not the branches (eight
    consumed kinds stay the same).
  - `@inbrowser/agent` becomes a dependency of
    `@piebox/driver-agent`, **not** of `examples/browser/`.
    Remove it from `examples/browser/package.json`.

- The playground now consumes `piebox/browser` + `@piebox/driver-agent`,
  exactly the two-package shape composable-sandbox.md proposed.

**Why this is fourth:** depends on Layer 2 (Step 3) being available
and on operations being piebox-native-typed (Step 2). Migrates the
*smaller* of the two coupling sites first (2 files in
`examples/browser/` vs 14 still-coupled files in `src/`) — A's
implication 5. Validates end-to-end that a driver consuming Layer 2
works in a real product (the playground), not just a spike.

The boundary-test count is **unchanged** in `src/` (this step only
moves examples/), but a *parallel* boundary check for
`examples/browser/` (added at the same time, banning
`@inbrowser/agent` from `examples/browser/src/`) lands at zero
violations.

**Public API change?** Yes — `@piebox/driver-agent` ships at 0.1.0
(unpublished but installable from the workspace). No piebox public
API change.

**Rollback note:** the riskiest step structurally. To revert cleanly:
- restore the two `examples/browser/src/` files from git;
- restore `@inbrowser/agent` to `examples/browser/package.json`;
- leave `packages/driver-agent/` in place (it's standalone — no
  consumers in piebox core depend on it yet). Or delete it; either
  is coherent. The playground works as before.

The reversibility holds because the playground migration is a single
PR's worth of file edits, contained to `examples/browser/`.

**Tests / verification:**
- Playground builds (`npm --workspace examples/browser run build`).
- Playground runs in a real browser: `read`/`write`/`bash`/`git_*`
  tools all execute successfully.
- The stress harness in `examples/browser/src/agent.ts` (the
  assertive-shell-test that landed in 8716974) passes against the
  new driver.
- `examples/browser/`-scoped boundary check (extended
  `BANNED_FROM_CORE` list + extended `CORE_PATHS` covering
  `examples/browser/src/`) exits 0.
- Network: confirm no spurious dependency duplication —
  `npm ls @inbrowser/agent` shows it under `@piebox/driver-agent`
  only, not `examples/browser/`.

---

### Step 5 — Move agent-loop scaffolding into @piebox/driver-agent (server-side)

**What changes:**

- Move from `src/` into `packages/driver-agent/src/`:
  - `src/session.ts` (the `createSandboxedSession` factory).
  - The agent-loop-specific parts of `src/sandbox.ts` —
    specifically `sb.createSession()`, `SessionOptions`, and any
    field on `SandboxInstance` that produces an `AgentSession`.
    The substrate-shaped parts of `src/sandbox.ts` (the
    `sandbox()` factory itself, `clone`, `git`, `vfs`, `shell`,
    snapshot helpers) stay in `src/` — those are Layer 1 / Layer 2
    concerns.
  - `src/types.ts`'s `SandboxSessionOptions` / `SandboxSessionResult`
    types move alongside the session factory.
  - `src/skills.ts` (skill loading is agent-specific —
    `Skill` is an `@earendil-works/pi-coding-agent` type) moves to
    `packages/driver-agent/src/skills.ts`. The
    `loadSkillsFromVFS` helper is re-exported from the driver,
    not from piebox core.

- The remaining `src/sandbox.ts` (Layer 1 portion) is reworked into
  a thin wrapper around `createSandbox` from Layer 2 — the substrate
  pieces (`fs`, `shell`, `git`, snapshot/export) become methods on the
  sandbox object that map to `Sandbox`'s `fs`, `runtime`, and
  workflow methods. Backwards compatibility: the legacy `sandbox()`
  factory keeps its old signature and delegates internally.

- `src/index.ts` shrinks:
  - Re-exports from `@earendil-works/pi-coding-agent`
    (`Skill`, `createSyntheticSourceInfo`) are removed — consumers
    that want those import them from `@piebox/driver-agent` instead.
  - `createSandboxedSession` is removed from the public surface; the
    docstring example near the top of `src/index.ts` is updated to
    show `import { createAgentDriver } from "@piebox/driver-agent"`.
  - `createSandboxedTools` from `src/tools.ts` is kept (it now
    produces Layer 2 `PieboxTool[]` via `createStandardToolset`).

- `src/tools.ts` is re-typed to return
  `PieboxToolset` (the Layer 2 shape) instead of
  `ToolDefinition[]` (the SDK shape). The internal wiring calls
  `createStandardToolset(sandbox)` rather than the
  `createXToolDefinition` family from
  `@earendil-works/pi-coding-agent`.

- The four files that still import
  `@earendil-works/pi-coding-agent` after Step 2 lose those imports:
  `src/index.ts`, `src/sandbox.ts`, `src/tools.ts`,
  `src/tools/npm-info.ts`.

- `examples/server/` (if any) — none today — would need migration
  too. Confirmed via `ls examples/` that only `browser/` exists, so
  no examples need updating in this step.

**Why this is fifth:** the heaviest step structurally. Depends on
Layer 2 being established (Step 3) and on the playground migration
having proved out the driver shape (Step 4) before more code commits
to it. Sequenced after Step 4 deliberately — if Step 4 surfaces a
problem with `@piebox/driver-agent`'s shape, Step 5 hasn't moved
yet, so the fix is local.

The boundary-test count drops to **zero violations in `src/`**
after this step. `src/` is fully migrated; `examples/browser/`
already migrated in Step 4. The gate is ready to flip to failing
in Step 6.

**Public API change?** **Breaking**, version-bump piebox to 1.0.0
(or 0.2.0 if pre-1.0 conventions are in use):
- Removed: `createSandboxedSession`, `loadSkillsFromVFS`, `Skill`
  re-export, `createSyntheticSourceInfo` re-export from `piebox`.
  Documented as moved to `@piebox/driver-agent`.
- Removed: `sandbox().createSession(...)` method. Documented as
  moved to `@piebox/driver-agent`'s `createAgentDriver(...)`.
- Kept: `sandbox()`, `createSandboxedTools` (now returns
  `PieboxToolset`), `createBrowserFs`, `createBrowserRuntime`,
  `createNodeFs`.
- Kept: Layer 2 entry (`piebox/layer2`).

CHANGELOG entry: "createSandboxedSession moved to
`@piebox/driver-agent`. Replace `import { createSandboxedSession }
from 'piebox'` with `import { createAgentDriver } from
'@piebox/driver-agent'`. Migration guide at
docs/migration-1.0.md (to be written)."

**Rollback note:** This step has the longest cleanup tail. To revert:
- restore `src/session.ts`, `src/skills.ts`, `src/types.ts` from git;
- restore the removed exports in `src/index.ts`;
- restore the removed pieces of `src/sandbox.ts`;
- delete the moved copies from `packages/driver-agent/src/`.

Because Step 4 already moved the playground onto
`@piebox/driver-agent`, rolling back Step 5 alone leaves the
playground building against `@piebox/driver-agent` (which still
exists, just doesn't have the server-side imports added in this
step). That's coherent — `@piebox/driver-agent`'s playground-facing
API doesn't depend on the server-side migration. Mid-stream rollback
is clean.

**Tests / verification:**
- Existing `src/secrets.test.ts` and `src/snapshot.test.ts` still pass
  (these don't touch the agent loop).
- A new `packages/driver-agent/test/session.test.ts` exercises the
  moved `createAgentDriver` (via the `pi-coding-agent` adapter)
  with a mocked LLM client and confirms the same multi-turn behavior
  the playground stress harness exercises.
- `bash scripts/boundary-test.sh` exits 0 against `src/` (the gate
  is now ready to fail loudly).
- A smoke script that does `npx piebox` style usage (if any
  exists; otherwise a hand-run `import { sandbox } from 'piebox';
  const sb = sandbox(); sb.shell.exec('echo hi')`) confirms the
  Layer 1 surface still works post-migration.

---

### Step 6 — Scaffold @piebox/driver-mcp, flip the boundary-test gate

**What changes:**

- Create `packages/driver-mcp/` mirroring `packages/driver-agent/`'s
  structure:
  - `package.json` (private until smoke-test passes), dependency on
    `@modelcontextprotocol/sdk`.
  - `src/index.ts` — exports `createMcpDriver`, `McpDriver`, matching
    [mcp-driver.ts](C-driver-spikes/mcp-driver.ts) from the spike.
    The spike's stand-in `McpServer` interface is replaced with the
    real `@modelcontextprotocol/sdk` types in this step.
  - `src/result-mapping.ts` — the `mapResultToMcp` helper from the
    spike, with the `dataIsInlinable` 4KB heuristic configurable.
  - `src/capabilities-resource.ts` — `buildCapabilitiesResource`
    helper.
  - `src/stdio-server.ts` — a runnable entrypoint that creates a
    sandbox, registers the standard toolset, and starts the MCP
    server over stdio. This is what Claude Desktop loads.

- Add `packages/driver-mcp/README.md` documenting how to install
  it in Claude Desktop (the `claude_desktop_config.json` snippet).

- Flip `.github/workflows/boundary.yml` from `continue-on-error: true`
  to a hard failure on non-zero exit. This is the gate.

- Promote `scripts/boundary-baseline.json` from "the baseline" to
  "the assertion": the script no longer accepts any violations.
  Delete the baseline file if it's served its purpose.

- Add `examples/browser/src/` and `packages/driver-mcp/src/` to
  the boundary script's secondary checks — `@earendil-works/*`
  banned from `examples/browser/`, `@inbrowser/agent` banned from
  `packages/driver-mcp/`, etc. The matrix:

  | path                                  | banned                                              |
  | ------------------------------------- | --------------------------------------------------- |
  | `src/` (core)                         | all four agent SDKs + `@piebox/driver-*`            |
  | `examples/browser/src/`               | `@earendil-works/*`, `@inbrowser/agent` (use driver-agent) |
  | `packages/driver-mcp/src/`            | `@inbrowser/agent`, `@earendil-works/*`             |
  | `packages/driver-agent/src/` (driver core, not adapters) | `@inbrowser/agent`, `@earendil-works/*` |

- The `packages/driver-agent/src/adapters/` subdirectory is
  explicitly *excluded* from the agent driver core's check — the
  adapters are where the SDK couplings legitimately live.

**Why this is sixth:** depends on Step 5 (core is clean) and on
Layer 2 being stable (Step 3). The MCP driver is the second real
driver, so it validates that the same `createSandbox` +
`createStandardToolset` calls that the agent driver makes work
unchanged from the MCP side. The gate flipping to failing is the
structural assertion that the refactor is complete.

If B (MCP prototype postmortem) unblocks before this step lands,
the prototype's classified findings get folded into the MCP driver's
implementation — specifically the lifecycle scaffolding, the
result-mapping shape, and any unexpected workarounds.

**Public API change?** Additive only: `@piebox/driver-mcp` ships at
0.1.0 (private). No piebox-core API change.

**Rollback note:** delete `packages/driver-mcp/`, revert the workflow
flip, restore the baseline file. The boundary script reverts to
report-only mode. The rest of the refactor is unaffected.

**Tests / verification:**
- `bash scripts/boundary-test.sh` exits 0 (already true after Step 5;
  this step asserts it via CI).
- CI fails when a deliberate violation is introduced (probe commit
  on a throwaway branch).
- **Claude Desktop smoke test:** install `@piebox/driver-mcp` per
  README, list-tools returns the eight standard tools (read, write,
  edit, bash, ls, grep, find, plus npm-info if enabled),
  `tools/call` for `read` and `bash` both succeed end-to-end.
- A read-only Vitest in `packages/driver-mcp/test/` calls
  `createMcpDriver(...)` with a fake transport and asserts the
  registered list-tools shape matches what the real SDK expects.
- The MCP `notifications/cancelled` path is tested with an
  abort-mid-tool scenario.

---

## 4. Dependency DAG

ASCII. Boxes are steps; arrows are "must land before."

```
                            ┌─────────────────────────────────────┐
                            │ Step 1: Promote boundary-test, CI   │
                            │  (tooling-only; no source change)   │
                            └────────────────┬────────────────────┘
                                             │
                                             ▼
                            ┌─────────────────────────────────────┐
                            │ Step 2: piebox-native operation     │
                            │         types (src/operations/      │
                            │         types.ts + 7 retypings)     │
                            └────────────────┬────────────────────┘
                                             │
                                             ▼
                            ┌─────────────────────────────────────┐
                            │ Step 3: Layer 2 — sandbox primitive │
                            │         + PieboxTool + Toolset      │
                            │         (src/layer2/, new entry)    │
                            └─────┬──────────────┬────────────────┘
                                  │              │
                  ┌───────────────┘              └───────────────┐
                  ▼                                              ▼
   ┌─────────────────────────────────┐         ┌─────────────────────────────────┐
   │ Step 4: scaffold @piebox/       │         │ Step 5: move session.ts +       │
   │ driver-agent, migrate           │         │ skills.ts + sandbox.ts agent    │
   │ examples/browser/ to it         │         │ loop into @piebox/driver-agent  │
   │ (smaller surface; 2 files)      │         │ (14 src/ files retyped/moved)   │
   └────────────────┬────────────────┘         └────────────────┬────────────────┘
                    │                                           │
                    │              (can run in parallel)        │
                    │                                           │
                    └─────────────────────┬─────────────────────┘
                                          ▼
                            ┌─────────────────────────────────────┐
                            │ Step 6: scaffold @piebox/driver-mcp │
                            │  + flip boundary-test gate to       │
                            │  failing. Refactor exit criteria.   │
                            └─────────────────────────────────────┘
```

Steps 4 and 5 can run in parallel after Step 3 lands. They share
`@piebox/driver-agent` as a target package but touch disjoint files:
Step 4 only edits `examples/browser/`; Step 5 only edits `src/`.
The package itself is additive in both directions. If the team
sequences them, Step 4 first is preferred (smaller, validates the
driver shape end-to-end before more code commits to it).

Step 6 strictly depends on Step 5 being done; the boundary gate
cannot flip while `src/` still has violations.

## 5. Migration of `src/operations/` (deep dive)

This is the load-bearing technical change. Eight files in
`src/operations/` (seven operation modules + one index) get
re-typed away from `@earendil-works/pi-coding-agent`.

### Per-file map

| File                          | Current return type (from SDK)         | Piebox-native equivalent (Step 2) | Compat?                              | Order |
| ----------------------------- | -------------------------------------- | --------------------------------- | ------------------------------------ | ----- |
| `src/operations/read.ts`      | `ReadOperations`                       | `./types.ts#ReadOperations`       | identical (structural)               | 1     |
| `src/operations/write.ts`     | `WriteOperations`                      | `./types.ts#WriteOperations`      | identical (structural)               | 2     |
| `src/operations/edit.ts`      | `EditOperations`                       | `./types.ts#EditOperations`       | identical (structural)               | 3     |
| `src/operations/ls.ts`        | `LsOperations`                         | `./types.ts#LsOperations`         | identical (structural)               | 4     |
| `src/operations/grep.ts`      | `GrepOperations`                       | `./types.ts#GrepOperations`       | identical (structural)               | 5     |
| `src/operations/find.ts`      | `FindOperations`                       | `./types.ts#FindOperations`       | identical (structural)               | 6     |
| `src/operations/bash.ts`      | `BashOperations` (takes `Bash`)        | `./types.ts#BashOperations`       | identical shape, but see note below  | 7     |
| `src/operations/index.ts`     | re-exports                             | re-export `./types.ts` too        | additive                             | 8     |

### Why the changes are structural (mostly)

Every operation in `src/operations/*` already implements its
interface by destructuring sync VFS calls. The SDK's type definitions
are themselves shaped after the same operations (they evolved
together). Concretely:

- `ReadOperations` = `{ readFile, access }` with async signatures
  returning `Buffer` / `void`. piebox-native equivalent is identical.
- `WriteOperations` = `{ writeFile, mkdir }`. Identical.
- `EditOperations` = `{ readFile, writeFile, access }`. Identical.
- `LsOperations` = `{ exists, stat, readdir }`. Identical.
- `GrepOperations` = `{ isDirectory, readFile }`. Identical.
- `FindOperations` = `{ exists, glob }`. Identical.
- `BashOperations` = `{ exec(command, cwd, options) → Promise<{exitCode}> }`.
  Identical signature, but `options` has a typed `onData(Buffer)`
  callback and `signal: AbortSignal`. The piebox-native type
  carries the same shape; the structural-compat test (Step 2's
  Vitest probe) catches drift.

### Heaviest: bash

`src/operations/bash.ts` is the heaviest because the portability
review's keystone change — bash going through `PieboxRuntime`
instead of holding a `Bash` instance — is a Step-7-ish concern that
G consciously *defers*. The Step 2 retype only touches the type
alias, not the implementation. The bash-through-runtime refactor
happens later as a substrate cleanup, after the driver split is
done.

Justification for the defer: the bash refactor is independent of
the driver decoupling. Today, `src/operations/bash.ts` takes a
`Bash`. After the driver split, the agent driver still passes a
`Bash` (via piebox's existing API). When portability-review's step
2 lands later, the agent driver swaps to passing a `PieboxRuntime`
— a one-line driver change, not a Layer 2 change. Keeping it out
of the migration scope keeps each step small.

### Order to migrate (under Step 2)

Read, write, edit are independent leaves — none depends on the
others' types. ls, grep, find are independent of each other and of
read/write/edit. Bash is independent of all of them but is the
biggest file. All seven can be migrated in a single PR (Step 2) or
split into a "leaves first, bash last" two-PR sequence if the team
prefers smaller diffs. The split is purely cosmetic — both
sequences land the same way.

## 6. examples/browser/ migration

Sequence and timing relative to `src/`:

| Step  | What happens in `examples/browser/`                                                         |
| ----- | ------------------------------------------------------------------------------------------- |
| 1     | No change.                                                                                  |
| 2     | No change.                                                                                  |
| 3     | No change. (Layer 2 lands but is not yet wired through here.)                               |
| **4** | **Migration step.** `agent.ts` + `agent/useAgentLoop.ts` re-imported off `@inbrowser/agent` and onto `@piebox/driver-agent`. All 11 tool definitions rewritten as `PieboxTool` shells. `@inbrowser/agent` dropped from `examples/browser/package.json`. |
| 5     | No change. (Server-side migration; does not touch examples.)                                |
| 6     | Boundary check extended to ban `@inbrowser/agent` from `examples/browser/src/`.             |

The playground is migrated **before** the server-side `src/` work
because it's smaller (2 files vs 14), it validates the
`@piebox/driver-agent` shape against a real product surface, and
the playground today is the canonical second-driver consumer that
piebox can verify against without external infrastructure.

The 11 tool migrations follow this pattern (using `writeTool` from
agent.ts:179 as a template):

```ts
// before
const writeTool: ToolHandler<{path: string, content: string}, void> = {
  name: 'write_file', description: '...', parameters: {...},
  async execute({path, content}, ctx) {
    await someVfsCall(path, content);
    return { ok: true, summary: `Wrote ${path}` };
  }
};

// after
const writeTool: PieboxTool<{path: string, content: string}> = {
  name: 'write_file', description: '...', inputSchema: {...},
  async execute({path, content}, sandbox, signal) {
    sandbox.fs.writeFileSync(path, content);
    return { ok: true, summary: `Wrote ${path}` };
  }
};
```

Note that the new shape drops the indirection through `ctx.workspace`
/ `ctx.runtime` — which A confirmed the playground's tools never
read.

After Step 4, `examples/browser/`'s shape is:

```
import { sandbox } from "piebox";
import { createBrowserFs, createBrowserRuntime } from "piebox/browser";
import { createSandbox, createStandardToolset } from "piebox/layer2";
import { createAgentDriver } from "@piebox/driver-agent";
import { inbrowserAgentLlmClient } from "@piebox/driver-agent/inbrowser-agent";

// wire fs + runtime
// const sb = createSandbox({fs, runtime, cwd: "/work"});
// const toolset = createStandardToolset(sb);
// const driver = createAgentDriver({sandbox: sb, toolset, llm: inbrowserAgentLlmClient(...)});
// for await (const ev of driver.submit(prompt, signal)) { ... }
```

## 7. Risk register

Honest enumeration, ranked roughly by likelihood × impact.

### R1 — Public API breakage at Step 5 (high impact, certain)

`createSandboxedSession`, `Skill` re-export, and the
`sandbox().createSession()` method are removed from `piebox` and
relocated to `@piebox/driver-agent`. Anyone consuming piebox
today hits this on upgrade.

**Mitigation:**
- Land Step 5 behind a major version bump (1.0.0).
- Ship a migration guide (`docs/migration-1.0.md`) with sed-able
  before/after import lines.
- Keep `@piebox/driver-agent` in the same monorepo so a single
  workspace install resolves both.
- Optionally: ship a 0.x compat shim package
  (`piebox-compat-0.x`) that re-exports the moved symbols from
  `@piebox/driver-agent` for one minor cycle. Cost: maintaining
  the shim. Decision deferred to the user.

**Known consumers today:** the playground (`examples/browser/`,
migrated in Step 4 already); any internal scripts or downstream
agents the user has not yet listed. Audit the user's own usage
sites before Step 5 merges.

### R2 — Multi-week refactor decay (medium likelihood, high impact)

If the refactor sits in a long-lived branch, it accumulates
merge conflicts with main and the cost-to-finish grows
non-linearly. Each of the six steps is sized to 1–3 days
deliberately, so the team can land them on `main` directly with
small PRs rather than a single megabranch.

**Mitigation:**
- Each step ships independently to `main`. No long-lived feature
  branch.
- Boundary-test stays in report-mode until Step 6 — main keeps
  building cleanly throughout.
- If a step starts to expand beyond ~3 days, split it. (Step 5 is
  the most likely to want splitting; see R3.)

### R3 — Step 5 is the largest step and may need splitting (medium likelihood)

Step 5 touches 14 files in `src/` and creates the server-side
half of `@piebox/driver-agent`. That's at the upper end of "1–3
days" sizing.

**Mitigation:** if Step 5 looks like >20 files or >3 days during
execution, split into 5a / 5b:

- **5a:** move `session.ts` + `skills.ts` + `types.ts` to
  `@piebox/driver-agent`; leave `src/sandbox.ts` and
  `src/tools.ts` untouched. The `sandbox().createSession()`
  method temporarily re-imports from `@piebox/driver-agent` via
  a peer dependency, keeping the public API stable.
- **5b:** re-type `src/sandbox.ts` + `src/tools.ts` to drop the
  SDK imports. Remove the temporary peer dep loop. Boundary-test
  in `src/` reaches zero.

The split adds one PR but keeps each PR <3 days and reversible.

### R4 — SDK version drift between agent driver adapters (low likelihood, medium impact)

`@piebox/driver-agent` ships two adapter subpaths:
`/pi-coding-agent` (server-side SDK) and `/inbrowser-agent`
(browser-side SDK). The two SDKs diverge over time. If the
adapters get out of sync, the driver behaves differently
depending on which adapter the consumer wires.

**Mitigation:**
- The C.1 spike already defines a piebox-internal `LlmClient`
  interface that both adapters target. Drift is bounded by what
  `LlmClient` requires.
- A Vitest in `@piebox/driver-agent/test/` exercises the same
  driver flow against two mock LLM clients (one shaped like
  pi-coding-agent, one shaped like inbrowser-agent) and asserts
  identical `AgentEvent` output. Catches drift before publication.

### R5 — B (MCP prototype) lands mid-refactor and forces re-planning of Step 6 (medium likelihood, low impact)

B is BLOCKED today. If the prototype arrives on this machine
during the refactor, the per-file classification might surface
unexpected workarounds, type-wrangling, or lifecycle scaffolding
that the spike-based MCP driver (C.2) does not anticipate.

**Mitigation:**
- The default-driven assumptions for Step 6 are documented
  (capabilities-as-resource, no per-tool annotations,
  single-sandbox-per-driver — section 2.4 above).
- If B's classification refutes any default, Step 6's PR includes
  the revised shape; the spike-based MCP driver is a *prototype
  of the prototype*, not a committed shape.
- Step 6 is the last step. If B's findings are large, the
  realistic outcome is "Step 6 ships as MVP MCP driver; a Step 7
  follow-up incorporates B's findings." Layered, not blocking.

### R6 — Boundary script's grep is too coarse (low likelihood, low impact)

F documented that grep doesn't catch transitive imports,
dynamic imports, or indirect type leaks. If the refactor leaves
a transitive leak undetected, the boundary appears clean but
isn't.

**Mitigation:**
- Manual structural review during Step 5 specifically looks for
  re-exports of agent-SDK types from `src/`.
- The Step 2 structural-compat Vitest test (assert assignability
  in both directions between piebox-native and SDK operation
  types) catches type drift at the operation boundary.
- After Step 6, an ad-hoc `madge --extensions ts src/` run
  produces a dep graph that can be eyeballed for unexpected
  edges. If a transitive leak is found, the boundary script can
  be extended at that point (rare; F said this is "revisit if a
  regression actually happens").

### R7 — The user's own usage sites are not enumerated

Outside the playground and the internal CLI under `src/cli/`,
piebox may have consumers the team doesn't know about. The
public API break at Step 5 affects them silently.

**Mitigation:** before Step 5 merges, the user does a personal audit
of any other repos that consume piebox. If any exist, those repos
get a follow-up PR concurrent with Step 5.

## 8. What stays where (summary table)

Three columns: file/module → destination after refactor → notes.

| File / module                              | Destination after refactor                                          | Notes                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/operations/read.ts`                   | stays in `src/operations/`                                          | retyped to piebox-native `ReadOperations` (Step 2). Body unchanged.                         |
| `src/operations/write.ts`                  | stays                                                               | retyped (Step 2).                                                                           |
| `src/operations/edit.ts`                   | stays                                                               | retyped (Step 2).                                                                           |
| `src/operations/ls.ts`                     | stays                                                               | retyped (Step 2).                                                                           |
| `src/operations/grep.ts`                   | stays                                                               | retyped (Step 2).                                                                           |
| `src/operations/find.ts`                   | stays                                                               | retyped (Step 2).                                                                           |
| `src/operations/bash.ts`                   | stays                                                               | retyped (Step 2). Bash-through-runtime is a separate later cleanup (portability §5 step 2). |
| `src/operations/index.ts`                  | stays                                                               | now re-exports both `./types.ts` and the operation factories.                               |
| `src/operations/types.ts` (NEW)            | created in Step 2                                                   | piebox-native operation type aliases.                                                       |
| `src/layer2/*.ts` (NEW)                    | created in Step 3                                                   | `Sandbox`, `PieboxTool`, `PieboxToolset`, `RuntimeCapabilities` re-export.                  |
| `src/sandbox.ts`                           | reworked in Step 5 (substrate kept; createSession removed)          | `sandbox()` becomes thin wrapper over `createSandbox`. `clone`/`git`/`snapshot` stay.       |
| `src/session.ts`                           | moves to `packages/driver-agent/src/session.ts` (Step 5)            | agent-loop concern.                                                                         |
| `src/skills.ts`                            | moves to `packages/driver-agent/src/skills.ts` (Step 5)             | `Skill` is `@earendil-works/pi-coding-agent`-typed.                                         |
| `src/tools.ts`                             | stays (re-typed in Step 5)                                          | returns `PieboxToolset` (Layer 2) instead of `ToolDefinition[]`.                            |
| `src/tools/npm-info.ts`                    | stays (re-typed in Step 5)                                          | becomes a `PieboxTool` instead of `ToolDefinition`.                                         |
| `src/streaming.ts`                         | stays                                                               | already browser-safe; D confirmed `executeStreaming` shape is unchanged.                    |
| `src/types.ts`                             | moves to `packages/driver-agent/src/types.ts` (Step 5)              | `SandboxSessionOptions` / `SandboxSessionResult` are agent-loop types.                      |
| `src/browser.ts`                           | stays                                                               | already clean; gets new exports from `src/layer2/` re-exposed for browser use.              |
| `src/index.ts`                             | stays, shrinks                                                      | re-exports trimmed in Step 5; consumers move SDK-shaped imports to `@piebox/driver-agent`.  |
| `src/fs/*.ts`                              | stays                                                               | already Layer 1; nothing to migrate.                                                        |
| `src/runtime/*.ts`                         | stays                                                               | already Layer 1.                                                                            |
| `src/adapters/*.ts`                        | stays                                                               | Layer 1 adapters; substrate concern.                                                        |
| `src/cli/streaming/*.ts`                   | stays                                                               | the existing CLI streaming pipeline; not Layer 3 yet.                                       |
| `src/secrets.ts` / `src/secrets.test.ts`   | stays                                                               | piebox-native; no SDK coupling.                                                             |
| `src/snapshot.test.ts`                     | stays                                                               | tests substrate.                                                                            |
| `src/git.ts`                               | stays                                                               | piebox-native via isomorphic-git.                                                           |
| `examples/browser/src/agent.ts`            | stays (rewritten in Step 4)                                         | imports flip from `@inbrowser/agent` to `@piebox/driver-agent`.                             |
| `examples/browser/src/agent/useAgentLoop.ts` | stays (rewritten in Step 4)                                       | `SessionEvent` → `AgentEvent`. Switch branches unchanged structurally.                      |
| `examples/browser/package.json`            | edited in Step 4                                                    | drops `@inbrowser/agent`; adds `@piebox/driver-agent`.                                      |
| `packages/driver-agent/` (NEW)             | new package, created in Step 4, populated in Step 5                 | houses `createAgentDriver`, `LlmClient` interface, and per-SDK adapters.                    |
| `packages/driver-mcp/` (NEW)               | new package, created in Step 6                                      | houses `createMcpDriver`, `mapResultToMcp`, capabilities-resource builder.                  |
| `scripts/investigations/boundary-test.sh`  | moves to `scripts/boundary-test.sh` (Step 1)                        | promoted from investigation prototype to canonical CI guard.                                |

## 9. Exit criteria for the refactor

The refactor (NOT the planning phase — that exits when G commits) is
"done" when **all** of the following hold:

1. **`bash scripts/boundary-test.sh` exits 0.** No file under `src/`,
   `examples/browser/src/`, `packages/driver-agent/src/` (driver
   core, excluding adapters), or `packages/driver-mcp/src/` imports
   any banned package. CI enforces this on every push.

2. **`examples/browser/` runs entirely on `@piebox/driver-agent`.**
   The two files that imported `@inbrowser/agent` now import from
   `@piebox/driver-agent`. The stress harness in
   `examples/browser/src/agent.ts` (assertive-shell test landed in
   commit 8716974) passes against the new driver. `@inbrowser/agent`
   appears in the workspace dependency graph only under
   `@piebox/driver-agent/src/adapters/inbrowser-agent.ts`.

3. **`@piebox/driver-mcp` published (privately or publicly) and a
   smoke test confirms it integrates with Claude Desktop** (or
   another MCP host). List-tools returns the eight standard tools;
   `tools/call` for at least `read` and `bash` succeed end-to-end;
   the `notifications/cancelled` abort path works.

4. **All `src/operations/*` files type their return values from
   piebox-native operation types (`src/operations/types.ts`).** No
   `import type { ... } from "@earendil-works/pi-coding-agent"` in
   any `src/operations/*.ts`. The structural-compat Vitest test
   from Step 2 asserts the piebox-native and SDK types remain
   mutually assignable (this is the cheap test that catches drift
   on either side).

5. **None of the divergent gaps from C's synthesis have re-leaked
   into core.** Concretely:
   - No `outputSchema` field on `PieboxTool` in `piebox/layer2`.
   - No `annotations` field on `PieboxTool`.
   - No `PieboxResource` type in `piebox/layer2`.
   - No multi-sandbox addressing API in `piebox/layer2`.
   - No `sandbox.chdir` method.
   - No tool-argv adapter helper in `piebox/layer2`.

   These were all consciously deferred or rejected in C's
   divergent-gaps section. If any has crept back in during the
   refactor, the migration overshot scope and the addition needs
   a separate proposal.

6. **All four `SessionEvent` dead branches are gone everywhere.**
   Search confirms zero references to `workspace_changed`,
   `runtime_changed`, `strategy_event` in `src/`,
   `examples/browser/src/`, `packages/driver-agent/src/`,
   `packages/driver-mcp/src/`. (Per D §2 observation 6 and the
   D-streaming.md conclusion.)

7. **Public API documented.** `README.md` and the package docstrings
   reflect the new shape:
   - `piebox` exports `sandbox()`, `createSandbox`,
     `createStandardToolset`, `createBrowserFs`/`createBrowserRuntime`/`createNodeFs`.
   - `@piebox/driver-agent` exports `createAgentDriver` +
     `LlmClient` adapters.
   - `@piebox/driver-mcp` exports `createMcpDriver` + a stdio entry
     point.

When all seven hold, the planning phase started by
[composable-sandbox.md](../explanation/composable-sandbox.md)
closes. The two follow-on items the portability review left open —
`createNodeRuntime` and bash-through-`PieboxRuntime` — remain queued
as Layer 1 cleanups, independent of this refactor's success.

## 10. What this plan explicitly does not do

In the spirit of the parent plan's "what this doc is not" section:

- **Does not refactor bash to go through `PieboxRuntime`.** That's
  portability-review step 2, deferred to a follow-up cleanup so
  this refactor stays focused on driver decoupling. The migration
  works either way.
- **Does not unify the two agent SDKs.** `@earendil-works/pi-coding-agent`
  and `@inbrowser/agent` remain independent shapes consumed via
  separate adapters under `@piebox/driver-agent/adapters/`.
- **Does not specify the MCP driver's wire protocol details.** B
  (when unblocked) is where those land. G adopts spike-shaped
  defaults and notes the revision points.
- **Does not move filesystem backends around.** Platformatic VFS
  on Node and almostnode on browser both stay. Filesystem unification
  is portability-review step 6, deferred until after the runtime
  work.
- **Does not introduce a session-pool driver.** It's named in the
  capability matrix and the streaming table but is not built. A
  later investigation can spike it against the same Layer 2.
- **Does not enforce transitive-import detection.** F documented
  this gap; G accepts it. Revisit only if a real regression
  surfaces.

The plan is intentionally minimal. Six steps, each shippable, each
reversible, each measurable. The boundary test going green is the
proof.
