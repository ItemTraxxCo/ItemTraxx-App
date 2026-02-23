#!/usr/bin/env bash
set -euo pipefail

echo "[security] npm audit (moderate+)"
npm audit --audit-level=moderate

echo "[security] scanning for unsafe dynamic code execution patterns"
if rg -n "\\beval\\(|new Function\\(" src supabase cloudflare >/tmp/itemtraxx-security-patterns.txt; then
  echo "Unsafe pattern(s) detected:"
  cat /tmp/itemtraxx-security-patterns.txt
  exit 1
fi
echo "No unsafe eval/new Function patterns found."

echo "[security] checking sample env file for committed private keys"
if rg -n "sb_secret_|SUPABASE_SERVICE_ROLE_KEY=.+|CLOUDFLARE_API_TOKEN=.+" .env.example >/tmp/itemtraxx-security-secrets.txt; then
  echo "Potential private secret assignment found in .env.example:"
  cat /tmp/itemtraxx-security-secrets.txt
  exit 1
fi
echo "No private secret assignments found in .env.example."

echo "[security] audit complete"
