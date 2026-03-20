#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
WORKER_DIR="$ROOT/cloudflare/edge-proxy"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to deploy the Cloudflare worker." >&2
  exit 1
fi

cd "$WORKER_DIR"
echo "[deploy] worker dir: $WORKER_DIR"
npx wrangler deploy "$@"
