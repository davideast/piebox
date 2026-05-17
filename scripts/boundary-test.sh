#!/usr/bin/env bash
# Piebox boundary check.
#
# Asserts that files under designated "core" paths (currently `src/`)
# do not import from packages designated "banned-for-core." Wired
# into CI as part of the Layer 2 refactor (see
# docs/investigations/G-migration.md Step 1). The CI step runs in
# report-only mode today and flips to failing in Step 6, once the
# refactor has actually drawn the Layer 2 boundary.
#
# Banned packages (must not appear in `src/` after the refactor):
#   @earendil-works/pi-coding-agent   — current server-side agent SDK
#   @earendil-works/pi-agent-core
#   @inbrowser/agent                  — current browser-side agent SDK
#   @inbrowser/relay
# Each will instead live behind a dedicated driver package
# (`@piebox/driver-agent`, `@piebox/driver-mcp`).
#
# Baseline (as of branch-off from main @ 0ebd665, before Step 1):
#   21 violations across 14 files.
# Note: A's audit reported "16 files touching @earendil-works/*" which
# included two `pi-ai` import sites that are intentionally NOT banned
# (`@earendil-works/pi-ai` is the model provider, not the agent SDK).
# The 21/14 numbers reflect only the banned-package imports.
# See scripts/boundary-baseline.json for the structured snapshot.
# Subsequent steps should drive this number monotonically toward 0.
#
# Usage:
#   bash scripts/boundary-test.sh             # human-readable
#   bash scripts/boundary-test.sh --quiet     # exit-code only
#
# Exit codes:
#   0 — all paths clean
#   1 — at least one violation
#   2 — script error (bad path, etc.)
#
# Why grep? See docs/investigations/F-boundary-enforcement.md for the
# full comparison vs madge / ESLint / vitest. Short version: piebox
# has no existing lint infrastructure, the enumerable core surface is
# small, and grep catches direct imports with zero install.
set -uo pipefail

ROOT="${PIEBOX_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

# ── Configuration ────────────────────────────────────────────────────────
# Paths that constitute piebox "core" (Layer 1 + Layer 2). After the
# refactor, anything that drives a specific protocol (agent loop, MCP,
# CLI) moves OUT of these paths into a driver subpackage.
CORE_PATHS=(
  "src"
)

# Packages that core may not import. The current state of each:
#   @inbrowser/agent              — clean (no imports in src/)
#   @earendil-works/pi-coding-agent — DIRTY (29 imports across 16 files)
#   @earendil-works/pi-agent-core  — DIRTY (2 imports)
BANNED_FROM_CORE=(
  "@inbrowser/agent"
  "@inbrowser/relay"
  "@earendil-works/pi-coding-agent"
  "@earendil-works/pi-agent-core"
)

# Paths that constitute the browser "core" once the refactor splits
# `piebox` from `@piebox/driver-agent`. Currently maps to the same
# `src/` until the split happens.
BROWSER_CORE_PATHS=(
  "src"
)

# ── Checks ───────────────────────────────────────────────────────────────
fail=0
total_violations=0

log() {
  [[ $QUIET -eq 1 ]] && return
  echo "$@"
}

check_path_against_package() {
  local path="$1" pkg="$2"
  if [[ ! -d "$path" ]]; then
    echo "ERROR: path '$path' does not exist" >&2
    exit 2
  fi
  # Match both `from "@x/y"` (named/default/type imports) AND
  # `import "@x/y"` (side-effect imports — rare for agent SDKs but
  # the pattern accepts no-questions-asked package usage). Both
  # single and double quotes.
  local matches
  matches=$(grep -rnE "(from|import)[[:space:]]+['\"]${pkg}(['\"]|/)" "$path" 2>/dev/null || true)
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

log "Boundary check"
log "─────────────"
log "Core paths:          ${CORE_PATHS[*]}"
log "Banned from core:    ${BANNED_FROM_CORE[*]}"
log ""

for path in "${CORE_PATHS[@]}"; do
  for pkg in "${BANNED_FROM_CORE[@]}"; do
    check_path_against_package "$path" "$pkg"
  done
done

log ""
if [[ $fail -eq 0 ]]; then
  log "✓ Core boundary clean — all paths free of banned imports."
else
  log "✗ Found $total_violations boundary violation(s)."
  log "  See docs/investigations/F-boundary-enforcement.md for context."
fi

exit $fail
