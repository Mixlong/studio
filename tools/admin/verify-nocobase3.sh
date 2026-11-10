#!/usr/bin/env bash
# Read-only checks for the generated NocoBase 3 Core application.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT/apps/digiwise-admin"
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ -f "$APP_DIR/package.json" ]] || fail "App not generated yet. Run: bash tools/admin/bootstrap-nocobase3.sh"
[[ -f "$APP_DIR/config.yml" ]] || fail "Missing local config.yml (kept out of Git). Follow docs/operations/nocobase3-local-poc.md."
command -v pnpm >/dev/null 2>&1 || fail "pnpm not installed"

printf 'Checking generated app configuration...\n'
(
  cd "$APP_DIR"
  pnpm nocobase config check --connect
)
printf '\nPASS: config and local database connection check.\n'
printf 'Still required: pnpm dev, sign-in, user/permissions tests and data persistence verification.\n'
