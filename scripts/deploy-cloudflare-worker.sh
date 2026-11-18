#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$ROOT/cloudflare/edge-proxy"
WRANGLER_BIN="$ROOT/node_modules/.bin/wrangler"

if [[ ! -x "$WRANGLER_BIN" ]]; then
  echo "The pinned Wrangler dependency is missing. Run npm ci from the repository root." >&2
  exit 1
fi

cd "$WORKER_DIR"
echo "[deploy] worker dir: $WORKER_DIR"
"$WRANGLER_BIN" deploy --config wrangler.toml "$@"
