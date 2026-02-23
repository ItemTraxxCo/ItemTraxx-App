#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-artifacts}"
OUT_FILE="${OUT_DIR}/sbom.cdx.json"

mkdir -p "${OUT_DIR}"

npx --yes @cyclonedx/cyclonedx-npm@4.1.1 \
  --output-file "${OUT_FILE}" \
  --output-format JSON

echo "[security] generated SBOM at ${OUT_FILE}"
