#!/usr/bin/env bash
# Bootstraps the official NocoBase 3 Core beta application in apps/digiwise-admin.
# Safe by default: never overwrites an existing app or starts production services.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT/apps/digiwise-admin"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail "Node.js >=24 is required; install Node 24+ first."
command -v pnpm >/dev/null 2>&1 || fail "pnpm >=11 is required; install pnpm 11+ first."

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
PNPM_MAJOR="$(pnpm --version | cut -d. -f1)"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] && (( NODE_MAJOR >= 24 )) || fail "Node.js 24+ required. Found $(node --version)"
[[ "$PNPM_MAJOR" =~ ^[0-9]+$ ]] && (( PNPM_MAJOR >= 11 )) || fail "pnpm 11+ required. Found $(pnpm --version)"

[[ ! -e "$APP_DIR" ]] || fail "Target already exists: $APP_DIR. Back it up and review before retrying; nothing was overwritten."

mkdir -p "$ROOT/apps"
printf 'Creating official NocoBase 3 beta application at %s\n' "$APP_DIR"
(
  cd "$ROOT/apps"
  PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 pnpm create @nocobase/app@beta digiwise-admin --template-tag=beta
)

[[ -f "$APP_DIR/package.json" ]] || fail "Scaffold did not generate package.json; inspect the npm/pnpm output."
cd "$APP_DIR"
mkdir -p storage

# config.yml contains application secrets and is intentionally ignored by Git.
pnpm nocobase config init --dialect sqlite --json
[[ -f config.yml ]] || fail "NocoBase did not create config.yml."
pnpm nocobase config check --connect

printf '\nScaffold created and config validated.\n'
printf 'Development startup: cd %q && pnpm dev\n' "$APP_DIR"
printf 'Initial credentials: check the official template; change the default admin password before exposing any network port.\n'
printf 'IMPORTANT: SQLite is for a local isolated PoC. PostgreSQL needs a separate clean initialization, not a switch of connection on populated data.\n'
