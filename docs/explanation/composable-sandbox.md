# Composable Sandbox: A Data-Rooted Plan

> Status: planning. No code moves until the investigations below produce data.
> The goal of this doc is to make the architecture decisions empirical instead
> of intuitive.

## Why this exists

The previous architecture work (see `portability-review.md`) treated piebox's
substrate as the central question — runtime, FS, capabilities, portability
between browser and server. That work still stands.

A second concern surfaced while prototyping an MCP server in front of the
sandbox: **the sandbox is too coupled to one driver**. Today the only way
to make piebox do useful work is to instantiate an agent loop through
`createSandboxedSession`. The agent SDK's types (`ToolContext`,
`SessionEvent`, `ToolHandler`) appear in the core. A second driver — MCP,
CLI, REST, custom — cannot use the sandbox without unwrapping or faking
those shapes.

The architectural intent is a three-layer separation:

```
Layer 3:  Drivers — agent, MCP, CLI, REST, custom. One per protocol.
          ─────────────────────────────────────────────────────────
Layer 2:  Capability surface — operations + tool descriptors + workflow
          functions (tarball, git-pack, session pool). Protocol-neutral.
          ─────────────────────────────────────────────────────────
Layer 1:  Substrate — PieboxFS + PieboxRuntime + capabilities object
          (almostnode-fork in browser, real Node + jail on server).
```

This doc plans how to validate that target with data before any code moves.

## The principle: data, not intuition

The shape above is plausible but unproven. Before the refactor starts, the
following propositions need empirical support:

1. The current coupling is in fact load-bearing (not cosmetic).
2. The proposed protocol-neutral tool descriptor handles every existing
   tool without forcing-fits.
3. The MCP prototype's workarounds map cleanly to specific abstraction
   leaks that the refactor closes.
4. At least three driver shapes (agent, MCP, CLI) can be implemented
   against the proposed Layer 2 in under a few hundred lines each.
5. Streaming requirements differ between drivers in ways that justify
   keeping streaming out of core.
6. The migration cost is bounded and reversible at every step.

If any of these turn out false, the architecture is wrong and the plan
needs to change. The investigations below are designed to surface that.

## The decisions that need to be made

These are the actual questions on the table. Each one is followed by the
data that resolves it.

### D1. Where exactly does the agent SDK leak into core?

**Decision needed:** Which files, types, and call-sites have to change.
**Data needed:** A full inventory of `@inbrowser/agent` imports across
`src/`, plus the shape of every `ToolContext` consumer.
**Resolved by:** Investigation A (codebase audit).

### D2. What is the protocol-neutral tool descriptor's shape?

**Decision needed:** The interface every tool implements. Specifically:
the return type, the signal handling, and what the tool function gets
access to (FS+runtime+cwd, or more).
**Data needed:** For every existing tool — what does it actually use
from `ToolContext`? What does it return? What would it need from an
MCP-shaped tool result (`Content[]`) that it can't produce today?
**Resolved by:** Investigation A + Investigation E (capability matrix).

### D3. What lives in core vs ships in driver packages?

**Decision needed:** Which functions, types, and store concepts stay in
the `piebox` package, and which move into `@piebox/driver-agent`,
`@piebox/driver-mcp`, `@piebox/driver-cli`.
**Data needed:** For each existing module: does it have a non-agent
consumer or could it? If yes → core. If only the agent driver needs it
→ driver-agent.
**Resolved by:** Investigation A + Investigation C (driver spikes).

### D4. How do drivers differ on streaming?

**Decision needed:** Whether streaming is a core concern (one streaming
contract that drivers consume) or a driver concern (each driver invents
its own).
**Data needed:** Per `SessionEvent` kind, who needs it? What does MCP's
notification model offer? Does a CLI driver need granular events or
just stdout? Does the session-pool surface need per-session streaming?
**Resolved by:** Investigation D (streaming requirements analysis).

### D5. Is the proposed Layer 2 actually sufficient?

**Decision needed:** Whether the protocol-neutral tool descriptor +
sandbox primitive + workflow surfaces are enough to implement multiple
real drivers, or whether something is missing.
**Data needed:** Three driver-shaped spike implementations against the
proposed Layer 2. Measure line counts, awkward type wrangling, things
the driver needs that core doesn't offer, things core has that the
driver can't use.
**Resolved by:** Investigation C (driver spikes).

### D6. Where does lifecycle live?

**Decision needed:** Whether `createSandbox()` / `sandbox.destroy()` are
explicit API, or implicit in module-scoped state like today's
`getRuntime()`. Whether sandboxes can be plural per process.
**Data needed:** What does the MCP prototype assume about sandbox
lifecycle? What does a CLI driver need? What does a session pool need?
**Resolved by:** Investigation B (MCP prototype postmortem) +
Investigation C.

### D7. How is the boundary verified once drawn?

**Decision needed:** Mechanical checks — eslint rules, dependency
graphs, package.json export maps — that prevent the boundary from
re-leaking later.
**Data needed:** Which mechanisms work in this codebase. Vitest tests
can assert "core doesn't import driver-agent"? A package.json export
map enforces it at install time? `madge --circular` finds re-leaks?
**Resolved by:** Investigation F (boundary enforcement).

### D8. What's the migration sequence?

**Decision needed:** Step ordering. Each step shippable in isolation,
each one reversible. No step requires the whole refactor to finish.
**Data needed:** Dependency graph between proposed changes. Which
changes are leaves (no consumers depending on them) and can move
first? Which are bottlenecks?
**Resolved by:** Investigation G (migration plan).

## The empirical investigations

Each investigation produces a deliverable that gets committed under
`docs/investigations/` so the data persists across sessions and
contributors. Each is sized to a single afternoon at most.

### A. Codebase audit

**Output:** `docs/investigations/A-codebase-audit.md`

A script-generated inventory:

- All imports of `@inbrowser/agent` across `src/`, `examples/browser/src/`,
  with file path and line.
- All `ToolHandler` definitions across both surfaces, with their parameter
  shapes, return shapes, and what they read from `ToolContext`.
- All consumers of `SessionEvent` and which event kinds they actually
  branch on.
- All references to `Workspace`, `RuntimeState`, `ChatMessage`,
  `TurnMetrics` — anything from the agent SDK type surface.

This is mechanical. A shell script (`scripts/audit-coupling.sh`)
plus a short prose summary identifying patterns.

### B. MCP prototype postmortem

**Output:** `docs/investigations/B-mcp-prototype.md`

The user has the MCP prototype on another machine. Once it's pulled
here:

- Read every file. Classify each piece of glue code into one of:
  *expected MCP shape*, *unexpected workaround*, *type-wrangling*,
  *streaming bridge*, *lifecycle scaffolding*.
- For each *unexpected workaround*: identify the piebox API that
  forced it.
- For each *type-wrangling*: name the type from `@inbrowser/agent`
  that leaked.
- Quantify: total lines, % spent on workarounds vs real MCP integration.

The hypothesis being tested: most of the prototype's glue is symptom
of Layer 2 not existing yet. The data either confirms or refutes
that.

### C. Driver spikes

**Output:** `docs/investigations/C-driver-spikes/{agent,mcp,cli}.ts`
+ a comparison writeup.

Write three minimal drivers — agent (~150 lines), MCP server
(~200 lines), CLI (~100 lines) — each against a *proposed* Layer 2
interface that exists only as a TypeScript declaration file in the
spike directory.

The proposed interface is consciously incomplete: start with the
minimum (sandbox primitive + tool descriptor + tarball export) and
let each driver tell us what's missing by failing to compile.

Per driver, measure:

- Lines of code excluding generated/boilerplate
- Number of times the driver had to reach into Layer 2 internals
- Imports needed beyond `piebox`
- What types the driver added that core didn't provide

Three drivers is the minimum sample. Two drivers can hide a leak
that's mistaken for "what drivers need" — three reveals which
concerns are driver-specific vs universal.

### D. Streaming requirements analysis

**Output:** `docs/investigations/D-streaming.md`

A table: rows = `SessionEvent` kinds (`turn_started`, `text`,
`thinking`, `tool_started`, `tool_finished`, `workspace_changed`,
`runtime_changed`, `turn_completed`, `error`, `completed`,
`strategy_event`), columns = drivers (`agent`, `mcp`, `cli`,
`session-pool`, `direct-call`).

Each cell: "needs", "doesn't need", "needs but in different shape".

The hypothesis: enough cells say "needs but in different shape"
that core *cannot* own a single streaming contract — it has to be
a driver concern. Or, the alternative hypothesis: there's a thin
streaming protocol that all drivers can consume, even if MCP
ignores it. Whichever the data supports wins.

### E. Capability matrix

**Output:** `docs/investigations/E-capabilities.md`

Two tables.

Table 1 — operation × capability: rows are operations (write, read,
bash, edit, ls, grep, find, git_init, …, toTarball, toGitPack),
columns are runtime capabilities (real-process-spawn, real-network,
native-addons, fs-kind, …). Cells are required/optional/not-used.

Table 2 — driver × capability: same columns, rows are drivers.
Cells are assumed/branches-on/ignores.

This is what the `capabilities` field on `PieboxRuntime` should be
shaped after. The portability review proposed the rough idea; this
turns it into a concrete enum.

### F. Boundary enforcement

**Output:** `docs/investigations/F-boundary-tests.md` + working
prototype.

Pick one mechanism and prove it works:

- Vitest test that imports the entire `piebox` package and asserts
  nothing from `@inbrowser/agent`, `@xterm/xterm`, or any driver
  is transitively pulled in.
- Or: `madge` dependency graph that produces a clean DAG of
  Layer 1 → Layer 2 only, with drivers as siblings.
- Or: ESLint rule that bans certain imports from certain paths.

Pick the lightest one that actually works. Boundary tests are how
the architecture survives a year of contributors.

### G. Migration plan

**Output:** `docs/investigations/G-migration.md`

Once A–F have produced data, sequence the changes:

- For each file in core today, identify destination: stays in core,
  moves to `@piebox/driver-agent`, moves to `@piebox/driver-mcp`,
  splits across multiple, deletes entirely.
- Build a dependency DAG of those moves: which moves unblock which.
- Identify the leaves — moves with no internal consumers — those
  go first.
- Each step in the plan: what files move, what tests cover it,
  what could break, what the rollback looks like.

Target: 5–7 numbered steps, each shippable on its own.

## Order of operations

The investigations have dependencies. Rough sequence:

```
A. codebase audit ──┬─→ E. capabilities ─┐
                    │                    │
B. MCP postmortem ──┼─→ C. driver spikes ┼─→ G. migration plan
                    │                    │
                    └─→ D. streaming ────┘
                                         │
                       F. boundary tests ┘  (in parallel with C/D)
```

A and B can run in parallel. C depends on a stable enough Layer 2
proposal that A and B should be drafted first. D and E can run
against the same artifacts. F is independent and can ship anytime.
G is the synthesis.

Best estimate: A is half a day, B is half a day once the prototype
is here, C is the bulk of the work (1–2 days for three spikes), D
and E are each half a day, F is a few hours, G is half a day.
Maybe a week of focused work end-to-end.

## Exit criteria for the planning phase

The planning phase is done — and code can begin — when:

1. All seven investigations have committed deliverables.
2. The three driver spikes (C) compile and run against the
   proposed Layer 2 with the lines/awkwardness metrics recorded.
3. The capability matrix (E) is closed: every cell decided.
4. The streaming analysis (D) recommends either "core owns it"
   or "drivers own it" with the data to back it up.
5. The migration plan (G) lists 5–7 numbered steps, each with
   a rollback note.
6. A boundary-enforcement mechanism (F) is chosen and a working
   prototype is in the repo.
7. The architectural hypothesis from the top of this doc is
   either confirmed by the data, or the doc is rewritten to
   match what the data actually says.

## What this doc explicitly is not

- A specification. The investigations produce the spec.
- A code change. Nothing in `src/` moves until the data is in.
- An RFC for community review. This is an internal plan; once the
  refactor lands, the README and a separate ADR cover the user-
  facing story.
- A schedule. Time estimates above are best-effort, not commitments.

## How this fits with the portability review

`portability-review.md` argued for the substrate becoming portable
across browser and server. This doc takes that as given and adds
the orthogonal concern: the substrate also needs to be portable
across drivers. The two together yield a 2×N matrix —

- browser substrate × agent driver (today's playground)
- browser substrate × MCP driver (planned, browser-hosted MCP)
- server substrate × agent driver (CLI/server agent runner)
- server substrate × MCP driver (Claude Desktop integration)
- browser/server × CLI driver (developer playground)
- browser/server × REST driver (external orchestrators)

— where every cell is implementable without re-writing the sandbox.
That is the long-form definition of "composable" in the title of
this doc.

The portability review's recommendations remain valid; this doc
adds a sibling recommendation that the same work be done with
driver decoupling in mind, not as a separate later effort.
