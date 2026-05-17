# Investigation B — MCP Prototype Postmortem

> Status: **BLOCKED on the prototype being available on this machine.**
> The prototype lives on a different machine; nothing analytical
> can happen until it's pulled here.

## What this investigation will do (when unblocked)

Read every file in the MCP prototype. Classify each piece of glue
code into one of five categories so we can quantify how much of the
prototype's effort was "real MCP integration" vs "working around
the absence of Layer 2."

### Classification taxonomy

| Category                | Definition                                                   |
| ----------------------- | ------------------------------------------------------------ |
| **MCP-shaped**          | Code that any MCP server would have: tool registration with the SDK, transport bootstrap, stdio handling, schema declaration, server lifecycle. Belongs in `@piebox/driver-mcp` regardless of refactor. |
| **piebox integration**  | Code that calls into piebox's substrate (fs, runtime, operations). The legitimate driver→Layer-2 boundary. |
| **Unexpected workaround** | Code that exists only because Layer 2 doesn't exist yet — re-implementing what `runInSandbox` does, re-routing git through isomorphic-git inline, hand-rolling tarball pack, etc. Each such workaround is a Layer 2 requirement the refactor must address. |
| **Type-wrangling**      | Code that exists only because the agent SDK's types leak into shared shapes — converting `ToolContext` to whatever the MCP server passes, unwrapping `ToolResult` into MCP's `Content[]`. Each such wrangle names a type that needs to live in Layer 2 instead. |
| **Lifecycle scaffolding** | Code that manages sandbox creation/destruction, concurrency, shutdown. Tells us what `sandbox.create()` / `sandbox.destroy()` need to look like. |

### Deliverables expected

1. **Per-file classification.** A markdown table: file path → line ranges → category → optional note. Goal: every non-trivial code segment classified.

2. **Workaround inventory.** A flat list of every "unexpected workaround" found, each tagged with:
   - what piebox API would have eliminated it
   - whether that API needs to be new (Layer 2 invention) or just re-exposed from `piebox/browser` / `piebox`
   - rough size (lines) of the workaround being replaced

3. **Type-wrangling inventory.** Same shape: each wrangle named, the agent-SDK type that forced it, the piebox-native shape that would have made it unnecessary.

4. **Lifecycle map.** How the prototype creates and tears down sandboxes. How long-lived an individual sandbox is. Whether there's a pool. Single-writer vs concurrent.

5. **Headline metric.** Percentage of prototype's lines spent on each category. Hypothesis being tested: at least 30% of the prototype is "unexpected workaround" or "type-wrangling." If that number is high, Layer 2 is well-justified and the refactor's scope is correctly sized. If it's low (under ~10%), then the abstraction the plan proposes might be solving a smaller problem than imagined and the plan should be revisited.

## Why this investigation is high-value

The MCP prototype is the only **real second driver** that exists. Every other driver (CLI, REST, custom) is speculative until built. The prototype is empirical evidence about which abstractions the second driver actually needs — speculation about MCP is no substitute.

In particular, this investigation directly resolves three of the eight decisions in the parent plan:

- **D2 (tool descriptor shape).** Whatever the prototype had to wrangle is what the new descriptor must accommodate.
- **D4 (streaming semantics).** Does the prototype need streaming? If yes, in what shape? If no, that's strong evidence streaming belongs to the agent driver only.
- **D6 (lifecycle).** The MCP server is a long-lived process; the prototype's lifecycle handling is the ground truth for `sandbox.create()` / `destroy()` design.

## Unblocking checklist

To start the investigation, the prototype needs to land on this machine:

- [ ] Repository or directory pulled to a known path (suggested: `~/Code/piebox-mcp-prototype/` or as a sibling to piebox)
- [ ] Brief orientation from the author: what works, what didn't, where the hairy parts are. Two paragraphs is enough; full memory dump not needed.
- [ ] Confirmation about MCP transport: stdio vs HTTP vs WebSocket. Affects which classification bucket some files land in.

Once those three are in place, the investigation runs in roughly half a day.

## What this investigation does not do

- Doesn't decide the MCP driver API. That's downstream — the prototype is *input* to the design, not the design itself.
- Doesn't fix the prototype. Findings get folded into the refactor; the prototype itself is treated as a postmortem subject.
- Doesn't speculate. If the prototype doesn't show evidence of needing some feature, the investigation doesn't recommend the feature.

## When unblocked, the work is

1. `git clone` or `cp -r` the prototype into a known path.
2. Read top-down: entry point → main loop → per-tool handlers → utilities.
3. Tag each non-trivial code block (functions, classes, > 10 lines) with one category.
4. Build the per-file table.
5. Build the workaround and type-wrangling inventories from the tagged blocks.
6. Write the headline metric: lines per category, percentages.
7. Commit findings to this file (replacing the BLOCKED notice at the top with the result).

Estimated time once unblocked: 3–4 hours of focused reading + 1 hour of writing.
