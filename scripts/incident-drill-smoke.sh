#!/usr/bin/env bash
set -euo pipefail

SITE_BASE="${1:-https://itemtraxx.com}"
EDGE_BASE="${2:-https://itemtraxx-edge-proxy.itemtraxx-co.workers.dev}"

for path in / /login /tenant/checkout /super-auth; do
  url="${SITE_BASE}${path}"
  echo "[drill] checking ${url}"
  curl -fsSI "$url" >/dev/null
  curl -fsSI "$url" | grep -i "content-security-policy" >/dev/null
  curl -fsSI "$url" | grep -i "strict-transport-security" >/dev/null
done

echo "[drill] checking system status"
curl -fsS "${EDGE_BASE}/functions/system-status" >/dev/null

echo "[drill] smoke checks passed"
