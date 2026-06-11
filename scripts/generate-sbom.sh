#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-artifacts}"
OUT_FILE="${OUT_DIR}/sbom.cdx.json"

mkdir -p "${OUT_DIR}"

./node_modules/.bin/cyclonedx-npm \
  --output-file "${OUT_FILE}" \
  --output-format JSON

echo "[security] generated SBOM at ${OUT_FILE}"
