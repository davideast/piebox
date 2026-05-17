#!/usr/bin/env bash
# Investigation F — boundary enforcement, prototype.
#
# Asserts that files under designated "core" paths do not import from
# designated "banned-for-core" packages. Designed to wire into CI once
# the refactor draws the Layer 2 boundary.
#
# Today the boundary doesn't exist yet — running this script against
# the current codebase WILL FAIL on the `@earendil-works/*` imports,
# which is the expected baseline. After the refactor lands, the same
# script run unchanged should exit 0.
#
# Usage:
#   bash scripts/investigations/boundary-test.sh           # check
#   bash scripts/investigations/boundary-test.sh --quiet   # exit-code only
#
# Exit codes:
#   0 — all paths clean
#   1 — at least one violation
#   2 — script error (bad path, etc.)
#
# Why grep? See docs/investigations/F-boundary-enforcement.md for the
# comparison vs madge / eslint / vitest. Short version: piebox has no
# existing lint infrastructure, the enumerable core surface is small
# (76 files), and grep catches direct imports without a node install.
set -uo pipefail

ROOT="${PIEBOX_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
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
  # Match both `from "@x/y"` and `from '@x/y'` forms.
  local matches
  matches=$(grep -rnE "from ['\"]${pkg}(['\"]|/)" "$path" 2>/dev/null || true)
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
