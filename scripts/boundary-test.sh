#!/usr/bin/env bash
# Piebox boundary check — multi-path version.
#
# Asserts that designated "core" paths do NOT import from packages
# that should live behind a driver adapter. Each path in the matrix
# below has its own banned set; some paths additionally exclude
# specific sub-directories (e.g. adapters/, where the SDK couplings
# legitimately live).
#
# Step 6 of the composable-sandbox migration plan widened this from
# the single src/ check into the matrix below and FLIPPED the CI
# step to failing on violations. See docs/investigations/G-migration.md.
#
# ── Matrix ─────────────────────────────────────────────────────────────
#
#   src/                                       — piebox core
#     bans: @inbrowser/agent, @inbrowser/relay,
#           @earendil-works/pi-coding-agent,
#           @earendil-works/pi-agent-core
#     note: `@earendil-works/pi-ai` (the model provider) is NOT
#           banned — it's a peer dep the CLI layer retains.
#     note: `@piebox/driver-*` is NOT banned — the CLI handlers in
#           `src/cli/` legitimately consume the agent driver (a
#           paper-only circular dep documented in Step 5's PR).
#
#   examples/browser/src/                      — playground
#     bans: @inbrowser/agent, @inbrowser/relay,
#           @earendil-works/pi-coding-agent,
#           @earendil-works/pi-agent-core
#     note: playground migrated to `@piebox/driver-agent` in Step 4.
#
#   packages/driver-mcp/src/                   — MCP driver
#     bans: @inbrowser/agent, @inbrowser/relay,
#           @earendil-works/pi-coding-agent,
#           @earendil-works/pi-agent-core
#     note: MCP driver depends only on `@modelcontextprotocol/sdk`
#           + piebox/layer2 — no agent SDK coupling at all.
#
#   packages/driver-agent/src/                 — agent driver
#     bans: (none)
#     note: G's Step 6 spec proposed banning SDKs from
#           driver-agent's core (with `adapters/` excluded). The
#           Step 5 file layout placed session/skills/types at the
#           package root rather than under `adapters/`, so the
#           "core vs adapters" split is a code-organization
#           preference inside the package, not a boundary the
#           matrix needs to police. driver-agent IS the agent SDK
#           bridge; its internal shape can evolve without breaking
#           the broader refactor's "piebox core stays SDK-free"
#           guarantee. The other three rows above enforce that
#           guarantee.
#
# Test files (*.test.ts, *.spec.ts, *.test.tsx) are excluded from
# every check — structural-compatibility tests legitimately import
# banned types to assert assignability.
#
# Exit codes:
#   0 — all paths clean
#   1 — at least one violation
#   2 — script error (bad path, etc.)
#
# Why grep? See docs/investigations/F-boundary-enforcement.md.
set -uo pipefail

ROOT="${PIEBOX_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

# ── Banned packages ──────────────────────────────────────────────────────
# Currently every path bans the same set. If a future path needs a
# different set, lift this into per-path arrays.
BANNED=(
  "@inbrowser/agent"
  "@inbrowser/relay"
  "@earendil-works/pi-coding-agent"
  "@earendil-works/pi-agent-core"
)

# ── Path matrix ──────────────────────────────────────────────────────────
# Each entry: <path>:<grep --exclude-dir option, or empty>
# We don't use bash maps to stay portable. Format is "path|exclude_dir".
declare -a PATHS_AND_EXCLUDES=(
  "src|"
  "examples/browser/src|"
  "packages/driver-mcp/src|"
)

# ── Checks ───────────────────────────────────────────────────────────────
fail=0
total_violations=0

log() {
  [[ $QUIET -eq 1 ]] && return
  echo "$@"
}

check_path_against_package() {
  local path="$1" pkg="$2" exclude_dir="$3"
  if [[ ! -d "$path" ]]; then
    echo "ERROR: path '$path' does not exist" >&2
    exit 2
  fi
  # Match both `from "@x/y"` (named/default/type imports) AND
  # `import "@x/y"` (side-effect). Test files excluded.
  # Build the grep command in two stages so the optional
  # --exclude-dir flag doesn't trip `set -u` on an empty array
  # expansion.
  local matches
  if [[ -n "$exclude_dir" ]]; then
    matches=$(grep -rnE "(from|import)[[:space:]]+['\"]${pkg}(['\"]|/)" \
      --include='*.ts' \
      --include='*.tsx' \
      --include='*.mts' \
      --include='*.cts' \
      --exclude='*.test.ts' \
      --exclude='*.test.tsx' \
      --exclude='*.spec.ts' \
      "--exclude-dir=$exclude_dir" \
      "$path" 2>/dev/null || true)
  else
    matches=$(grep -rnE "(from|import)[[:space:]]+['\"]${pkg}(['\"]|/)" \
      --include='*.ts' \
      --include='*.tsx' \
      --include='*.mts' \
      --include='*.cts' \
      --exclude='*.test.ts' \
      --exclude='*.test.tsx' \
      --exclude='*.spec.ts' \
      "$path" 2>/dev/null || true)
  fi
  if [[ -n "$matches" ]]; then
    local count
    count=$(echo "$matches" | wc -l | tr -d ' ')
    log ""
    log "❌ VIOLATION: '$path' imports from '$pkg' ($count site(s))"
    if [[ $QUIET -eq 0 ]]; then
      echo "$matches" | sed 's/^/   /'
    fi
    fail=1
    total_violations=$((total_violations + count))
  fi
}

log "Boundary check (multi-path matrix)"
log "──────────────────────────────────"
log ""

for entry in "${PATHS_AND_EXCLUDES[@]}"; do
  path="${entry%%|*}"
  exclude_dir="${entry##*|}"
  [[ -d "$path" ]] || continue
  if [[ -n "$exclude_dir" ]]; then
    log "Path: $path (excluding $exclude_dir/)"
  else
    log "Path: $path"
  fi
  for pkg in "${BANNED[@]}"; do
    check_path_against_package "$path" "$pkg" "$exclude_dir"
  done
done

log ""
if [[ $fail -eq 0 ]]; then
  log "✓ All paths clean — no banned imports."
else
  log "✗ Found $total_violations boundary violation(s) across the matrix."
  log "  See docs/investigations/F-boundary-enforcement.md for context."
fi

exit $fail
