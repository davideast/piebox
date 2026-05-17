# Investigation C — Driver Spikes Synthesis

> Three driver spikes (agent, MCP, CLI) compiled against the proposed
> Layer 2 surface. This doc consolidates what they revealed: which
> Layer 2 fields stood up, which fell over, and what gets revised
> before code moves into `src/`.

## Spike outcomes at a glance

| Spike            | Path                                     | Lines | Compile status | Layer 2 gaps surfaced |
| ---------------- | ---------------------------------------- | ----- | -------------- | --------------------- |
| C.1 — agent      | [agent-driver.ts](agent-driver.ts)       | 340   | compiles       | 7                     |
| C.2 — MCP        | [mcp-driver.ts](mcp-driver.ts)           | 285   | compiles (strict) | 9                  |
| C.3 — CLI        | [cli-driver.ts](cli-driver.ts)           | 230   | compiles       | 6                     |
| D — streaming    | [../D-streaming.md](../D-streaming.md)   | 464   | n/a (analysis) | resolves D4           |

**Total spike code: ~855 lines for three drivers.** The agent driver is the largest because it implements the ReAct loop + multi-turn history threading. The CLI driver is the smallest (terminal adapter is supplied by the caller). The MCP driver sits in the middle because the SDK adapter surface (list-tools + call-tool handlers + capabilities-as-resource) takes real code.

All three compile against `layer2.d.ts` with **no `any` casts and no `@ts-ignore`**, which is the strongest signal that the Layer 2 contract is approximately right. The gaps are real but they're requirement-shaped, not type-soundness-shaped.

## Convergent gaps — Layer 2 revisions applied

These are the gaps **two or more spikes hit independently**. Anything in this category is a real architectural issue, not a single spike's quirk.

### G1 — `PieboxResult.exitCode` missing — hit by C.1, C.2, C.3

All three spikes either lost exit-code fidelity or duck-typed `data.exitCode`:

- C.1 (agent) JSON-serializes results into history but can't distinguish "tool failed but ok=true" from "exit 0" without convention.
- C.2 (MCP) duck-types `data?.exitCode` to set `isError` on `McpToolCallResult`.
- C.3 (CLI) drops the `[exit N]` line that ShellSession had today.

**Revision applied:** `exitCode?: number` added to `PieboxResult` ([layer2.d.ts](layer2.d.ts) `interface PieboxResult`). Process-shaped tools set it; non-process tools leave it undefined. Drivers branch on `exitCode === undefined ? !ok : exitCode !== 0` as the canonical "failed" check.

### G2 — `PieboxToolset.get(name)` missing — hit by C.1 implicitly, C.3 explicitly

Both spikes built a local `Map<string, PieboxTool>` to dispatch by name. The toolset should own that index — three lookup helpers across drivers is exactly the cross-driver inconsistency Layer 2 exists to prevent.

**Revision applied:** `get(name: string): PieboxTool | undefined` added to `PieboxToolset` ([layer2.d.ts](layer2.d.ts) `interface PieboxToolset`).

### G3 — Sandbox lifecycle hook absent — hit by C.1, C.2

C.1 noted ambiguous ownership across multiple `submit` calls. C.2 wants to fire MCP `notifications/resources/list_changed` when a sandbox dies. The portability review previously flagged this as "decide one writer or coordinate writes." A `'destroyed'` lifecycle event covers both.

**Revision applied:** `Sandbox.on(event: 'destroyed', handler)` added ([layer2.d.ts](layer2.d.ts) `interface Sandbox`). Kept narrow — D's "no events without consumers" principle says additional event kinds land only when a driver demands them.

### G4 — Abort semantics for in-flight tools unspecified — hit by C.1, C.2

C.1 noted the contract is silent on what happens to in-flight `tool.execute` when the parent submit is aborted. C.2 specifically needs this for MCP's `notifications/cancelled` protocol.

**Revision applied:** Documented in `Sandbox.destroy` and on `PieboxTool.execute` (already takes a signal). Behavior: tools that honor their `AbortSignal` return shortly after; tools that don't honor it may leak (tool bug, not a sandbox concern). Drivers should not assume ordering — they await explicitly if needed.

## Divergent gaps — deferred or rejected

These are gaps a single spike hit. Each gets a verdict: deferred to a later investigation, rejected (not Layer 2's concern), or "fix in driver, not core."

### From C.1 (agent driver)

| Gap                                                     | Verdict                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| No way to read/refresh capabilities mid-session         | **Reject.** Capability fingerprint doesn't change mid-session unless the runtime is swapped (and that's a new sandbox). The agent driver reads once at start. |
| `inputSchema` vs `parameters` naming mismatch with agent SDK | **Reject.** Layer 2 follows MCP's naming since MCP is now a peer driver. Agent driver pays a one-line rename in its adapter — trivial. |
| `data` serialization contract not documented            | **Defer to G.** Document in the migration plan that `PieboxResult.data` should be JSON-serializable; non-serializable shapes (`Uint8Array`, circular refs) are tool bugs. |
| No driver-level toolset filtering API                   | **Fix in driver, not core.** A driver that wants a subset constructs a new toolset from `existing.tools.filter(...)` plus a fresh `get`. Layer 2 stays minimal. |

### From C.2 (MCP driver)

| Gap                                                     | Verdict                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| No `toJSON` on `RuntimeCapabilities`                    | **Fix in driver, not core.** Drivers serialize as needed; the `RuntimeCapabilities` type is already a plain object so `JSON.stringify(caps)` works directly. C.2 over-engineered this. |
| No multi-sandbox / pool addressing                      | **Defer to session-pool investigation.** Out of MVP scope. Single-sandbox-per-driver is fine for now. |
| No per-tool annotations (`readOnlyHint`, `destructiveHint`) | **Defer.** MCP-specific affordance. If/when a second driver wants the same annotations, promote to Layer 2 as `PieboxTool.annotations?: Record<string, boolean>`. For MVP, MCP driver computes them locally based on tool name. |
| No `outputSchema` on `PieboxTool`                       | **Defer.** MCP-specific, low value. Most agent SDKs and the CLI don't consume output schemas. |
| No `PieboxResource` paralleling `PieboxTool`            | **Defer.** Resources are MCP-specific. The MCP driver wraps capabilities-as-resource locally; a `PieboxResource` type only earns its keep if a second driver wants resources too. |
| No sandbox-lifecycle `onDestroyed`                      | **Resolved by G3** above. |
| `summary` is optional but MCP requires non-empty content | **Fix in driver.** MCP driver substitutes a default string when `summary` is absent. Layer 2 stays permissive. |

### From C.3 (CLI driver)

| Gap                                                     | Verdict                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| No tool argv-shape adapter (`{ command }` vs `{ _raw }`) | **Fix in driver.** The CLI driver owns argv → tool-args mapping; it knows the user typed `bash` and routes accordingly. Layer 2 shouldn't model command-line conventions. |
| `sandbox.cwd` is readonly with no `chdir`               | **Fix in driver.** `cd` is a CLI builtin, not a sandbox method. The CLI driver tracks its own cwd and passes it per-call to `runtime.run`. ShellSession does this today. |
| No "stream drained but still running" signal            | **Defer.** Edge case for backpressure. If it becomes a real issue, add `executeStreaming` returning an `AsyncIterable` instead of using callbacks. D's investigation kept the callback shape; revisit if a real driver needs it. |
| `interactiveTty` only readable by driver, not by tools  | **Reject.** Tools shouldn't branch on this — they emit output and let the driver/terminal handle rendering. If a tool genuinely needs to know (e.g. a hypothetical `repl` tool), pass it via args. |

## What D resolved

[D-streaming.md](../D-streaming.md) ran on the same evidence base (the four-driver column space) and concluded:

- **Streaming belongs in the driver layer, not core.** Layer 2 keeps the one streaming primitive that's already there: `PieboxTool.executeStreaming(args, sandbox, signal, onChunk)`. No core event union, no `AsyncIterable<PieboxEvent>` in `piebox`.
- **Drop the three dead `SessionEvent` branches** (`workspace_changed`, `runtime_changed`, `strategy_event`) — the audit confirmed they're unused by the playground, and the streaming table showed they don't earn slots in any driver's event shape.
- **The agent driver's event union ships in `@piebox/driver-agent`**, not in piebox core.

Together with C, this validates the layering: Layer 2 surfaces one streaming hook; each driver builds its own event model on top.

## Layer 2 status after the revisions

```diff
 interface PieboxResult<Data = unknown> {
   ok: boolean;
   summary?: string;
   data?: Data;
+  exitCode?: number;
 }

 interface PieboxToolset {
   readonly tools: readonly PieboxTool[];
+  get(name: string): PieboxTool | undefined;
 }

 interface Sandbox {
   /* ... */
+  on(event: SandboxEvent, handler: () => void): { dispose(): void };
   destroy(): void;
 }
+
+type SandboxEvent = 'destroyed';
```

Four small revisions. Everything else in [layer2.d.ts](layer2.d.ts) stayed unchanged through three driver implementations. That's the strongest signal we'd expect from this kind of investigation — the contract held.

## What this resolves in the parent plan

| Plan decision                                            | Status after C+D                                             |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| **D2 — protocol-neutral tool descriptor shape**          | ✓ Resolved. `(args, sandbox, signal) → PieboxResult<T>` with optional `executeStreaming` callback. Validated by three drivers. |
| **D3 — core vs driver split**                            | ✓ Resolved. Layer 2 = sandbox + tools + workflow + capabilities. Drivers = agent/MCP/CLI/direct each own their event model, transport, lifecycle scaffold. |
| **D4 — streaming semantics**                             | ✓ Resolved. Driver concern, not core. One per-tool `executeStreaming` hook is enough. |
| **D5 — Layer 2 sufficiency**                             | ✓ Resolved. Three drivers compile cleanly against the contract; four small revisions surfaced and applied. |
| **D6 — sandbox lifecycle**                               | ✓ Resolved. Explicit `createSandbox()` + `destroy()` + `on('destroyed', ...)`. Single-writer per sandbox; multi-sandbox lives in driver code. |

D1 (where the leaks are) was resolved by A. D7 (boundary enforcement) was resolved by F. **D8 (migration plan) is the only decision left for G.**

## Open items the spikes did not test

The four-driver column doesn't cover everything that will eventually exist. Honest enumeration of what these spikes don't tell us:

1. **MCP wire-level correctness.** C.2 uses a stand-in interface, not the real `@modelcontextprotocol/sdk`. The first real MCP integration will surface protocol-level issues the spike can't anticipate. B (when unblocked) will test this against an actual prototype.

2. **Streaming under backpressure.** D recommended the callback shape; nobody stress-tested it yet. If a `bash` command emits megabytes of stdout faster than the terminal can render, the callback model might need adjustment.

3. **Cross-process / cross-tab sandboxes.** The session-pool driver is named but not spiked. Multi-sandbox addressing isn't in Layer 2 today. Defer to a session-pool investigation if/when one is scoped.

4. **Real upstream piebox compilation.** The spikes compile against a hypothetical `layer2.d.ts`, not against the actual piebox codebase. The migration plan (G) is what actually moves the existing `src/` code under this contract; the spikes are predictions about how easy that move will be.

## Acceptance criteria

- [x] Three driver spikes written, each in its own file
- [x] All three compile against `layer2.d.ts` with no `any` / no suppression directives
- [x] Each spike's gap-analysis block at the end of the file
- [x] Convergent gaps applied to `layer2.d.ts` (G1–G4)
- [x] Divergent gaps catalogued with verdicts (defer / reject / fix-in-driver)
- [x] D's recommendation reconciled with C's findings
- [x] Plan-level decisions D2–D6 marked resolved with evidence

All met. **C and D close together.** G is the only remaining investigation, and it now has everything it needs.
