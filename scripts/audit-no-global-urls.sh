#!/usr/bin/env bash
# Audit a build directory (or extracted asar) for forbidden global infrastructure URLs.
# Excludes node_modules per agreed scope: vendor packages may contain inert global URLs
# that don't cause runtime calls, so we audit our own code only.
#
# Usage: scripts/audit-no-global-urls.sh [target-dir]
#   default target: build/china

set -euo pipefail

TARGET="${1:-build/china}"

if [ ! -d "$TARGET" ]; then
  echo "[audit] target directory not found: $TARGET" >&2
  exit 1
fi

FORBIDDEN='api\.github\.com|googleapis\.com|youtube\.com|googleusercontent\.com|login\.microsoftonline\.com|api\.githubcopilot\.com|mcp\.atlassian\.com|applicationinsights\.azure\.com|dc\.applicationinsights\.azure\.com'

echo "[audit] scanning $TARGET (excluding node_modules) for forbidden hosts..."

if grep -REn \
    --include='*.js' \
    --include='*.json' \
    --include='*.html' \
    --include='*.cjs' \
    --include='*.mjs' \
    --exclude='*.test.js' \
    --exclude='*.spec.js' \
    --exclude-dir='node_modules' \
    "$FORBIDDEN" "$TARGET"; then
  echo "" >&2
  echo "[audit] FAIL: forbidden global URL(s) found in $TARGET" >&2
  exit 1
fi

echo "[audit] PASS: no forbidden URLs found in $TARGET (outside node_modules)"
