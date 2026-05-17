# Investigation D — Streaming Requirements Analysis

> Decides D4 in the parent plan (`composable-sandbox.md`): does streaming
> belong in Layer 2 (one streaming contract that all drivers consume) or
> in each driver (each invents its own)?

## 1. The question

The agent driver today consumes a `SessionEvent` union (`turn_started`,
`text`, `thinking`, `tool_started`, `tool_finished`, `turn_completed`,
`error`, `completed`, plus three dead branches `workspace_changed`,
`runtime_changed`, `strategy_event`). Other drivers (MCP, CLI,
session-pool, direct-call) have different protocols and different ideas
of "an event." The question this investigation resolves is whether
piebox should commit to a single streaming contract that every driver
consumes (lifting `SessionEvent` or a piebox-native equivalent into
Layer 2), or whether streaming is irreducibly per-driver and Layer 2
should expose only the primitives — tool execution with an `onChunk`
hook — leaving each driver to compose its own event model on top.

## 2. Table 1 — SessionEvent kinds × drivers

Cells: **needs** / **doesn't need** / **different shape** (footnoted).

| Event kind          | agent  | mcp                 | cli                | session-pool       | direct-call   |
| ------------------- | ------ | ------------------- | ------------------ | ------------------ | ------------- |
| `turn_started`      | needs  | doesn't need        | different shape ¹  | different shape ² | doesn't need  |
| `text`              | needs  | different shape ³   | different shape ⁴  | doesn't need ⁵     | doesn't need  |
| `thinking`          | needs  | different shape ⁶   | different shape ⁷  | doesn't need ⁵     | doesn't need  |
| `tool_started`      | needs  | doesn't need ⁸      | different shape ⁹  | different shape ¹⁰ | doesn't need  |
| `tool_finished`     | needs  | different shape ¹¹  | different shape ⁹  | different shape ¹⁰ | doesn't need  |
| `turn_completed`    | needs  | different shape ¹²  | different shape ¹³ | different shape ¹⁰ | doesn't need  |
| `error`             | needs  | different shape ¹⁴  | different shape ¹⁵ | different shape ¹⁶ | different ¹⁷  |
| `completed`         | needs  | doesn't need        | different shape ¹⁸ | different shape ¹⁰ | doesn't need  |
| `workspace_changed` | doesn't need | doesn't need  | doesn't need       | different shape ¹⁹ | doesn't need  |
| `runtime_changed`   | doesn't need | doesn't need  | doesn't need       | doesn't need       | doesn't need  |
| `strategy_event`    | doesn't need | doesn't need  | doesn't need       | doesn't need       | doesn't need  |

**Totals:** 11 rows × 5 drivers = **55 cells**, all filled.

- `needs` (consumes the event in its present shape): **9** cells
- `doesn't need` (event has no consumer in this driver): **24** cells
- `different shape` (semantic intent overlaps, but the wire shape, granularity, or fan-out is incompatible): **22** cells

Footnotes:

1. CLI driver wants a banner / spinner start, not a structured event. A
   prompt indicator (`agent> `) printed once is sufficient — the event's
   identity is a side-effect, not a payload.
2. Session-pool wants a per-sandbox `session_started(sandboxId)` event,
   not a per-turn one. The pool driver isn't running turns; it's
   running whole sessions concurrently.
3. MCP protocol has no in-tool streaming. Text deltas from an LLM
   surface either as a single MCP `tool/call` response, or — if the
   driver runs the agent loop server-side — as MCP `progress`
   notifications. Per-token granularity is irrelevant; chunk-level or
   sentence-level is what clients render.
4. CLI wants raw stdout: bytes written to a TTY as they arrive. No
   `{kind:'text', chunk:...}` envelope — just `process.stdout.write`.
5. Session-pool aggregates many sandboxes into a tournament-style
   stream. Per-token text from a single run is too high-bandwidth and
   not useful at the aggregate level. The pool wants per-sandbox state
   changes (`running` → `succeeded`/`failed`), not the contents.
6. MCP `progress` notification at most; many MCP clients hide
   thinking entirely.
7. CLI prints thinking dimmed, prefixed (`(thinking) ...`), and only if
   a `--verbose` flag is on. Different stream (stderr), different
   gating.
8. MCP's `tools/call` is the boundary. Within one MCP tool call there
   is no sub-event for "the model decided to call a tool" — that's the
   request itself. If the agent driver runs inside an MCP server (the
   meta-case: MCP wrapping an agent), it batches and surfaces
   tool-started as a `progress` ping.
9. CLI wants `→ bash: <cmd>` printed as a single line at start, and
   `← exit 0 (1.2s)` at finish. No structured envelope, just framed
   stdout writes.
10. Session-pool re-keys all per-call events by sandbox id and folds
    them into a leaderboard / state-machine view. The shape is
    `(sandboxId, lifecycleState, lastSummary?)`, not the original event.
11. MCP returns `tool_finished` as the response body of the `tools/call`
    request (or as the final `progress` if streaming progress is used).
    The shape is `Content[]` (text blocks, possibly with `isError`) —
    not piebox's `{ok, summary, data}`.
12. MCP has no per-turn semantic. If the agent loop runs inside an MCP
    server, `turn_completed` becomes the moment a `tools/call` response
    is finalized. Metrics (`tokensIn`/`tokensOut`) are typically not
    surfaced over MCP at all.
13. CLI prints a single summary line: `done in 4.3s, 2814 tokens`.
    Metrics are formatted, not streamed.
14. MCP errors arrive as `tools/call` response with `isError: true` and
    text content — or as a JSON-RPC error code on transport failures.
    Not the same shape as `{kind:'error', message}`.
15. CLI prints `error: <message>` to stderr and exits non-zero. The
    exit code is part of the contract; the agent driver has no exit
    code.
16. Session-pool surfaces errors as terminal states of the per-sandbox
    state machine. Backtraces stay on the sandbox; the aggregate stream
    only sees the transition.
17. Direct-call gets errors via `Promise.reject` (thrown from `await
    sandbox.tools.read.execute(...)`). Never as an event in a stream.
18. CLI exits the process. Not an event; a syscall.
19. Session-pool needs file-system changes per sandbox (for diff
    aggregation, "which run mutated package.json"), but the existing
    `workspace_changed` event in `@inbrowser/agent` is dead in the
    playground and its shape isn't clearly defined. The pool would
    likely model it as a derived signal computed from `toGitPack` / fs
    polling rather than as a streamed event.

### Observations from Table 1

1. **The agent driver is the only one with majority `needs`.** Eight of
   eleven event kinds map cleanly to its existing consumption. The
   playground's `handleEvent` switch (verified in
   `useAgentLoop.ts:194-283`) is the prima facie evidence — the same
   eight kinds appear there.

2. **MCP has zero `needs` cells.** Every event MCP would consume needs
   reshaping into either `tools/call` response bodies or `progress`
   notifications. This isn't a Layer-2 question — it's a protocol
   constraint. MCP tools return *once*. There is no in-tool incremental
   streaming surface in the MCP spec. (Resource subscriptions and
   `notifications/progress` exist, but they are protocol-level, not
   tool-level.)

3. **CLI has zero `needs` cells either.** Every cell is `different
   shape` because the CLI's output target is a TTY with byte semantics,
   not a tagged-union receiver. The CLI doesn't want envelopes; it
   wants formatted lines.

4. **Session-pool's needs are at a coarser granularity** than the
   per-turn events. Of nine in-scope events it `doesn't need` three
   and reshapes five. The one it might use directly is `error` (still
   reshaped). The pool's event model is `(sandboxId, transition)`, not
   `(turn, chunk)`.

5. **Direct-call needs none.** This validates the "direct API returns
   once" baseline. The cell that's not `doesn't need` is `error`,
   which surfaces via `Promise.reject` — a JS native channel, not a
   streaming protocol.

6. **The three dead branches stay dead.** `workspace_changed`,
   `runtime_changed`, `strategy_event` have no consumer in any of the
   five drivers. The audit (A) already flagged them as dead in the
   playground; this table confirms they're dead everywhere. They
   should not appear in Layer 2 at all.

7. **The "events that all drivers care about" set is empty.** No row
   in the table reads `needs` across all five columns. Even `error`
   (the most universal concept) takes five different shapes.

## 3. The four hypotheses

### H1 — Core owns streaming. One union, all drivers consume.

Layer 2 exports a `PieboxEvent` union (likely a piebox-native rename of
the eight in-scope `SessionEvent` kinds). Every driver subscribes to
the same stream.

- **What the data says:** the agent column reads `needs` for eight
  events; the other four columns read `needs` zero times combined.
  H1 satisfies one driver cleanly and forces the other four into
  adapter code that reshapes every event. The "single contract" is in
  fact the agent driver's contract dressed up as universal.
- **Cost:** drags an agent-shaped event model into Layer 2. Adapter
  code for MCP/CLI/pool is written *against the wrong shape* — every
  driver pays the translation cost on every event.
- **Breaks:** MCP can't faithfully represent the union (no in-tool
  streaming surface — see footnote 8/11/12). CLI doesn't want the
  envelope at all. Session-pool re-keys everything by sandbox id, so
  the union is wrong-shape for aggregation. Direct-call ignores the
  union entirely, so it pays no cost — but the cost it doesn't pay is
  evidence the union isn't universal.

### H2 — Drivers own streaming. Each driver invents its own event model.

Layer 2 has no streaming surface at all. Tools expose only `execute`.
Each driver layers its own event model on top however it wants.

- **What the data says:** satisfies every `different shape` and
  `doesn't need` cell trivially — each driver picks its own shape.
  Doesn't satisfy the agent driver's `needs` cells *for free* — the
  agent driver still has to produce those events, but now it has to
  do so without piebox's help, which means inventing its own
  per-tool stdout/stderr capture and threading it through.
- **Cost:** repeated work. Each driver that wants live tool output
  (agent, CLI, anything else interactive) re-implements
  child-process stdout capture, signal forwarding, and chunk
  forwarding. Three drivers × ~50 lines of plumbing = 150 lines of
  redundant glue.
- **Breaks:** the substrate already has the stdout/stderr seam
  (`runtime.run`'s `onStdout` / `onStderr` callbacks — see `layer2.d.ts`
  L92-99). Forcing every driver to wire that seam independently
  squanders an existing primitive. Also makes the "shell driver
  reuses agent's bash output" story harder than it should be.

### H3 — Hybrid. Layer 2 exposes per-tool streaming hooks. Drivers compose higher-level events.

`PieboxTool.executeStreaming(args, sandbox, signal, onChunk)` is the
Layer 2 primitive. Drivers that want tagged-union events
(`tool_started`, `tool_finished`, `text`) compose them themselves. Tools
own incremental output; drivers own the *event model*.

- **What the data says:** satisfies the cells where the *source* of
  the data is the tool (everything tool-related — rows 4, 5, 8). The
  agent driver wraps `executeStreaming` calls in
  `tool_started`/`tool_finished` envelopes itself. The CLI driver
  pipes `onChunk` straight to stdout. The MCP driver ignores
  `executeStreaming` entirely (calls `execute` only) — which is
  exactly right for a protocol with no in-tool streaming. The
  session-pool driver calls `execute` per-sandbox and emits its own
  aggregate-level events. Direct-call uses `execute`. **No driver is
  forced into the wrong shape.**
- **What's left unaddressed:** `text` / `thinking` / `turn_completed`
  are NOT tool-output — they come from the LLM. H3's `executeStreaming`
  doesn't help with those. Those events live entirely in the agent
  driver and don't need to be in Layer 2 at all (the four non-agent
  driver columns confirm this: none of them needs LLM-level events in
  their native shape).
- **Cost:** the `executeStreaming` optional method is one extra
  function on the tool descriptor. Tools that have no streaming
  source (read/write/edit/ls/grep/find/git_*) leave it undefined.
  Only bash needs it.
- **Breaks:** nothing in the table. The `different shape` cells
  become "driver translates from `onChunk` + final `PieboxResult` to
  its own event shape," which is the *right* place to translate.

### H4 — Streaming-as-callback (no async iterables; just `onChunk`).

A specialization of H3. The primitive is *exclusively* a callback;
there is no `AsyncIterable<PieboxEvent>` at the Layer 2 boundary at
all. Drivers that want async iteration build it themselves by piping
callbacks into a queue (one-line adapter).

- **What the data says:** identical satisfaction profile to H3 for
  the cells in the table — every tool-sourced cell is served by
  `onChunk`. The difference is what *Layer 2 doesn't ship*: no event
  union, no iterator helper.
- **Cost:** drivers that want async iteration write the
  callback→queue adapter (~10 lines). Trivial.
- **Breaks:** nothing in the table, but worth flagging:
  back-pressure is harder with callbacks than with iterators (the
  callback can't ask the producer to pause). For the bash use case
  this is fine — child-process stdout is bounded by the process —
  but a hypothetical future "stream a 5GB file in chunks" tool would
  prefer a pull model. Not a concern today.

## 4. Recommendation

**H3 (Hybrid).** With the `executeStreaming` method as the only
Layer 2 streaming surface.

Justification, read off the table:

- The agent driver has eight `needs` cells, all of which decompose
  into either (a) tool output, served by `executeStreaming`'s
  `onChunk`, or (b) LLM-level events (`text`, `thinking`,
  `turn_completed`) which the agent driver synthesizes from its
  *own* LLM client and which no other driver consumes.
- MCP / CLI / session-pool / direct-call have *zero* `needs` cells
  and 22 `different shape` cells between them. H1 would force
  adapter code for all 22; H3 lets each driver synthesize its own
  events in its own shape using only `execute` (for one-shot results)
  and `executeStreaming`'s `onChunk` (for live tool output).
- The data does not support a universal event union in Layer 2. No
  event kind has consumer parity across drivers. The closest
  candidates (`error`, `tool_finished`) still reshape per driver.

H4 is strictly simpler than H3 and would satisfy the same cells, but
H3 is what the existing `layer2.d.ts` already proposes and it costs
nothing extra to keep the option open. The recommendation collapses
to H4 in practice because no Layer 2 event union is shipped — only
the per-tool streaming hook. Call it H3-via-H4 if you like; the wire
shape is the callback.

## 5. Concrete shape

The Layer 2 streaming contract is exactly the optional method already
sketched in `layer2.d.ts` (L262-268). Restated with explicit
contracts:

```ts
export interface PieboxTool<Args = unknown, Data = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: PieboxToolSchema;

  /**
   * One-shot execution. All tools implement this. Returns the final
   * buffered result. Tools that produce no incremental output (read,
   * write, edit, ls, grep, find, git_*) implement only this method.
   */
  execute(
    args: Args,
    sandbox: Sandbox,
    signal: AbortSignal,
  ): Promise<PieboxResult<Data>>;

  /**
   * Streaming execution. Optional. Tools that have a meaningful
   * incremental output (bash; future: long-running compilation,
   * test-runner with per-test results) implement this in addition
   * to `execute`. Drivers that want live output call
   * `executeStreaming` and ignore `execute`; drivers that don't
   * (MCP, direct-call) call `execute` and ignore `executeStreaming`.
   *
   * Contract:
   *   - `onChunk(text, stream)` is called zero or more times, in
   *     order of arrival, before the returned promise resolves.
   *   - `text` is a string slice; it may contain partial lines, UTF-8
   *     multi-byte boundaries are preserved (the tool concatenates
   *     bytes into safe boundaries before calling).
   *   - `stream` is `'stdout' | 'stderr'`. No third channel.
   *   - The returned `PieboxResult.data` SHOULD include the full
   *     buffered stdout/stderr in the same fields drivers expect from
   *     `execute` — streaming is ADDITIVE, not REPLACEMENT. A driver
   *     that read every chunk MAY discard the buffered fields; a
   *     driver that called `executeStreaming` but only cares about
   *     the final result MAY ignore `onChunk` entirely.
   *   - `signal.aborted` causes the underlying process to be killed.
   *     The tool then resolves (or rejects) — abort is cooperative
   *     and prompt, not synchronous.
   *   - Back-pressure is NOT modeled. `onChunk` is best-effort
   *     fire-and-forget. Drivers that need back-pressure (a slow
   *     network sink) buffer in the driver layer.
   */
  executeStreaming?(
    args: Args,
    sandbox: Sandbox,
    signal: AbortSignal,
    onChunk: (text: string, stream: "stdout" | "stderr") => void,
  ): Promise<PieboxResult<Data>>;
}
```

**What Layer 2 does NOT ship:**

- No `PieboxEvent` union.
- No `AsyncIterable<PieboxEvent>` at the sandbox or toolset level.
- No `text` / `thinking` / `turn_completed` event types.
- No `SessionEvent`-shaped surface anywhere in piebox.

**What each driver layers on top:**

- **agent driver** (`@piebox/driver-agent`) ships its own `AgentEvent`
  union with `turn_started` / `text` / `thinking` / `tool_started` /
  `tool_finished` / `turn_completed` / `error` / `completed`. The
  driver wraps `executeStreaming` calls in `tool_started`
  /`tool_finished` envelopes, threads the LLM client's text/thinking
  deltas, and yields the union. The two agent SDKs already in use
  (`@inbrowser/agent`, `@earendil-works/pi-coding-agent`) each become
  *consumers* of `@piebox/driver-agent`'s events, not producers of
  their own competing event types in core.

- **MCP driver** (`@piebox/driver-mcp`) ships zero streaming surface.
  Each tool call is `await tool.execute(args, sandbox, signal)` and
  the result is mapped to MCP `Content[]` + `isError`. Progress
  notifications (if the server runs an inner agent loop) are
  synthesized at the MCP layer, not propagated from Layer 2.

- **CLI / shell driver** ships its own line-oriented surface. Calls
  `executeStreaming` for bash, pipes `onChunk` directly to
  `process.stdout.write` / `process.stderr.write`. No tagged union.

- **Session-pool driver** ships `PoolEvent` =
  `{sandboxId, transition: 'started' | 'succeeded' | 'failed',
  summary?}`. Calls `execute` (not `executeStreaming`) on each
  sandbox's tools — the pool doesn't care about per-chunk output,
  only per-run outcome. Aggregates many running sandboxes into one
  stream.

- **Direct-call** is `await sandbox.tools.read.execute({path})`. No
  streaming. Errors via `Promise.reject`.

**New event kinds nobody has yet:**

The table noted one missing piece: session-pool needs a per-sandbox
filesystem-change signal that doesn't exist in the current
`SessionEvent` union (`workspace_changed` is dead and ill-defined).
This is **not** a Layer 2 streaming concern — it's a derived signal
the session-pool driver can compute from periodic `toGitPack` or
`fs` polling. Flag for the session-pool driver spike, not for Layer 2.

## 6. What this resolves in the parent plan

This investigation closes **D4 — How do drivers differ on streaming?**

**Decision:** streaming lives in the **driver layer**, not in core.

Layer 2 ships exactly one streaming primitive: the optional
`executeStreaming(args, sandbox, signal, onChunk)` method on
`PieboxTool`. No event union, no `AsyncIterable`, no `SessionEvent`-
shaped surface. Drivers that want a tagged-union event model build it
themselves on top of `execute` + `executeStreaming`.

This is consistent with the table: no event in the eleven-kind union
has cross-driver consumer parity, and 22 of 55 cells reshape the
event. A core streaming contract would be wrong-shape for four of
five drivers. The hybrid primitive is right-shape for all five.

Concrete consequences for the parent plan:

- **D1 / D3 (where the leak lives, what stays in core):** the
  `SessionEvent` union currently re-exported from `@inbrowser/agent`
  becomes a `@piebox/driver-agent`-private type. Nothing in `piebox`
  or `piebox/browser` re-exports event types. The audit (A) already
  noted `SessionEvent` is a load-bearing leak; D confirms the leak
  belongs in the driver, not in core.
- **D5 (Layer 2 sufficiency):** the existing `layer2.d.ts`
  `executeStreaming` shape is correct and stays. The C-driver spikes
  should validate that the agent / MCP / CLI drivers can each be
  written against only `execute` + `executeStreaming` without
  reaching for a piebox-side event union.
- **Dead branches (`workspace_changed`, `runtime_changed`,
  `strategy_event`):** confirmed dead across all five drivers. Do
  not migrate. Delete from any piebox-facing surface; if the upstream
  SDK keeps them, the agent driver ignores them.

## 7. Acceptance criteria

- [x] Table 1 complete: 11 rows × 5 drivers = 55 cells, every cell
  filled. (`needs` 9, `doesn't need` 24, `different shape` 22.)
- [x] Each hypothesis weighed against the table, not against intuition.
  H1 fails 4/5 columns. H2 satisfies every cell but wastes the
  `runtime.run` `onStdout`/`onStderr` seam. H3 satisfies every cell
  at minimum cost. H4 is H3 with a smaller surface and is the
  *de facto* shape after H3 settles.
- [x] Concrete type signatures for the recommendation. See section 5;
  the signature is the existing `layer2.d.ts` `executeStreaming`
  method with contract clarifications on chunk boundaries, abort,
  and back-pressure.
- [x] Decision relays to D4 in the parent plan. Section 6 states
  explicitly: streaming belongs in the driver layer; Layer 2 ships
  only the per-tool `executeStreaming` primitive; no
  `SessionEvent`-shaped surface in core.

## 8. Open questions surfaced (for later investigations)

1. **Does `executeStreaming` need a `meta` event channel** for
   non-stdout/stderr signals (e.g. "this is the test-runner's tenth
   passing test", structured progress)? Today no in-scope tool needs
   it. Defer until a tool with structured incremental progress shows
   up (compilers, test runners, long downloads).

2. **Should `onChunk` be allowed to throw**, signaling
   "consumer-side cancellation, please stop the underlying process"?
   Currently the only cancellation channel is `AbortSignal`. The
   answer is probably "no — keep `onChunk` fire-and-forget; consumers
   wanting cancellation use the signal" but the C-driver spikes
   should confirm.

3. **Should the agent driver's own internal event union be
   exported as `@piebox/driver-agent/events`** so that consumers
   composing a custom UI (the playground today) have a typed surface,
   even though Layer 2 doesn't expose it? Yes, almost certainly. The
   playground already imports `SessionEvent` from `@inbrowser/agent`;
   moving that import to `@piebox/driver-agent` is a clean rename. Not
   a Layer 2 concern.

4. **Does the session-pool driver need a piebox-side
   `workspace_changed` event after all** (computed from fs polling
   in core, not the agent loop)? Open question for the session-pool
   driver spike, but the default assumption is no — the pool
   computes it from `toGitPack` diffs on transition boundaries, not
   as a streamed event during a run.
