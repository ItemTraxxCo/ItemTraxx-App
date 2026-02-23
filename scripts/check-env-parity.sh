#!/usr/bin/env bash
set -euo pipefail

REQ_FILE=".github/required-env.txt"
ENV_FILE=".env.example"

missing=0
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  if ! grep -qE "^${key}=" "$ENV_FILE"; then
    echo "[ci] missing required key in ${ENV_FILE}: ${key}"
    missing=1
  fi
done < "$REQ_FILE"

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

echo "[ci] env parity check passed against ${ENV_FILE}"
