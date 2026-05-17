# Investigation F — Boundary Enforcement Mechanism

> Goal: pick the lightest mechanism that prevents agent-SDK leaks from
> creeping back into core after the refactor draws the Layer 2
> boundary. Prove it works.

## Decision

**Use a checked-in shell script that greps for banned imports in
designated core paths.** Wire it into CI as a build step. Wire it
locally as a pre-commit hook if desired. No npm install. No config
file.

The prototype lives at `scripts/investigations/boundary-test.sh` and
will be promoted (renamed, made permanent) when the refactor lands.

## Why this and not the alternatives

Four candidate mechanisms were considered. The ranking is by
**cost-to-introduce + cost-to-maintain**, given piebox's current
state (no existing lint infrastructure, 76 files in `src/`).

| Mechanism                  | Install cost | Config burden | Catches transitive? | Edit-time feedback | Verdict          |
| -------------------------- | ------------ | ------------- | ------------------- | ------------------ | ---------------- |
| **Shell grep**             | none         | minimal       | no (direct only)    | no                 | **picked**       |
| ESLint `no-restricted-imports` | `npm i -D eslint` + plugins | per-package rules in eslint config | no | yes (IDE squiggles) | overkill today |
| Madge dependency graph     | `npm i -D madge` | `madge --image deps.svg` plus a parse step | yes  | no | overkill today |
| Vitest + TS compiler API   | none (already on vitest) | non-trivial test that programmatically traverses imports | yes | no | over-engineered |

**Why grep wins for piebox today:**

1. **No install.** Piebox has no eslint, no madge, no lint dependency
   today. Adding one for a single enforcement rule is poor value.
2. **Piebox's core is small and enumerable.** The whole core is 76
   files. Direct-import checking covers every realistic regression
   path; transitive coverage isn't needed when the enumeration is
   small enough to grep entirely. A leaked transitive import would
   be in some `src/` file directly, which the script catches.
3. **CI integration is one line.** `bash scripts/.../boundary-test.sh`
   in a GitHub Actions job. No node setup, no config.
4. **Reproducible offline.** Anyone with bash can run it. No
   internet, no registry. Survives upstream tooling churn.

**Why not ESLint:** the config sprawl is real. ESLint v9 flat config
+ TypeScript plugin + `no-restricted-imports` per-path overrides
adds ~30 lines of config and one transitive dep tree. Worth it for
projects that already use ESLint. Not worth it for piebox's first
lint rule. Re-evaluate after the refactor lands if the project grows
into needing more rules.

**Why not madge:** great for visualizing dep graphs (useful during
the refactor itself, see G) but as a recurring boundary test it's
heavier than grep with no extra signal. Madge can be used ad-hoc
during the refactor to draw graphs; grep is for the steady-state
guard.

**Why not vitest:** the cleanest version of this — a test that
programmatically walks the import graph — is the most robust, but
writing the walker correctly (handling re-exports, dynamic imports,
type-only imports) is more work than the value of catching those
cases. Revisit if a transitive-leak regression actually happens.

## What the prototype proves

Two runs against the current codebase:

### Run 1: current state (refactor hasn't happened yet)

```
$ bash scripts/investigations/boundary-test.sh --quiet
$ echo "exit: $?"
exit: 1
```

Full output identifies **21 boundary violations** across 16 files:

- `@earendil-works/pi-coding-agent` — 19 import sites in `src/`
- `@earendil-works/pi-agent-core` — 2 import sites in `src/`
- `@inbrowser/agent` — 0 (clean)
- `@inbrowser/relay` — 0 (clean)

This is the expected baseline. The refactor's success metric is
"this script exits 0 after Layer 2 is drawn."

### Run 2: simulated post-refactor state

Substituting the banned package names with strings that intentionally
don't match anything in the tree (simulating a successful refactor):

```
$ PIEBOX_ROOT="$(pwd)" bash /tmp/sim.sh --quiet
$ echo "exit: $?"
exit: 0
```

The script correctly exits 0 when no banned imports are present. The
mechanism works in both directions — flags violations, accepts a
clean tree.

## Configuration shape

The script's configuration is two arrays at the top:

```bash
CORE_PATHS=(
  "src"
)

BANNED_FROM_CORE=(
  "@inbrowser/agent"
  "@inbrowser/relay"
  "@earendil-works/pi-coding-agent"
  "@earendil-works/pi-agent-core"
)
```

Adding a new banned package or expanding core paths is a one-line
edit. The refactor will likely:

1. Add new entries to `BANNED_FROM_CORE` as driver-specific packages
   get identified (e.g. `@piebox/driver-agent`,
   `@piebox/driver-mcp` — once those exist, the core may not
   import them either).
2. Possibly split `CORE_PATHS` into `LAYER_1_PATHS` and
   `LAYER_2_PATHS` if Layer 1 ends up with stricter rules than
   Layer 2.
3. Add a parallel set for the browser entry — once
   `examples/browser/src/` moves into `@piebox/driver-agent`, the
   replacement consumer should have its own boundary check.

## CI wiring (when ready)

A single step in the existing CI workflow:

```yaml
- name: Boundary check
  run: bash scripts/investigations/boundary-test.sh
```

No setup-node needed for this step. Fails the build on exit 1.

## What this mechanism does NOT catch

Documented so future regressions don't surprise anyone:

- **Transitive imports.** If file A in core imports file B in core
  and B imports `@earendil-works/pi-coding-agent`, the script
  flags B (correctly) but doesn't flag A. As long as the
  enumerated `CORE_PATHS` cover every entry into the layer, this
  is fine.
- **Dynamic imports.** `import("@inbrowser/agent")` at runtime is
  invisible to grep. If it becomes a real risk, the rule can be
  extended with a second pattern.
- **Re-exports.** `export * from "@inbrowser/agent"` is grep-able
  with the same pattern (`from "..."`) so this is actually caught.
- **Indirect leaks via inferred types.** A core function whose
  return type is `ReturnType<typeof someAgentSDKThing>` doesn't
  trigger an import but does leak the agent SDK's shape into core.
  This requires structural review during the refactor (it's a
  one-time concern), not a recurring check.

## Acceptance criteria

This investigation passes when:

- [x] A prototype exists at `scripts/investigations/boundary-test.sh`.
- [x] It runs to completion against the current codebase.
- [x] It returns exit 1 with a violation list on the current codebase
      (matching the expected baseline from investigation A).
- [x] It returns exit 0 when banned imports are simulated as removed.
- [x] No npm install needed.
- [x] Configuration is editable in a single file with no other
      changes.

All five met. F is closed.

## When to promote

Move `boundary-test.sh` from `scripts/investigations/` to
`scripts/` (canonical location) when:

1. Investigation G's migration plan is committed.
2. The first refactor step lands and at least one banned package
   is fully removed from `src/`.
3. CI is wired to run the check.

Until then it stays in the investigation directory.
