#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

require_env "SUPABASE_BACKUP_DATABASE_URL"
require_env "SUPABASE_BACKUP_REPO"
require_env "SUPABASE_BACKUP_REPO_TOKEN"
require_env "SUPABASE_BACKUP_ENCRYPTION_PASSPHRASE"

BACKUP_REPO="$(printf '%s' "$SUPABASE_BACKUP_REPO" | xargs)"
BACKUP_TOKEN="$(printf '%s' "$SUPABASE_BACKUP_REPO_TOKEN" | xargs)"
BACKUP_BRANCH="$(printf '%s' "${SUPABASE_BACKUP_REPO_BRANCH:-main}" | xargs)"
BACKUP_PREFIX="${SUPABASE_BACKUP_PREFIX:-supabase}"
BACKUP_GIT_USERNAME="$(printf '%s' "${SUPABASE_BACKUP_GIT_USERNAME:-mmango10}" | xargs)"
USE_DOCKER_PG_DUMP="${SUPABASE_BACKUP_USE_DOCKER_PG_DUMP:-false}"
PG_DUMP_DOCKER_TAG="${SUPABASE_BACKUP_PG_DUMP_TAG:-17}"
TIMESTAMP_UTC="$(date -u +"%Y-%m-%d_%H-%M-%S")"
YEAR="$(date -u +"%Y")"
MONTH="$(date -u +"%m")"
DAY="$(date -u +"%d")"

WORK_DIR="$(mktemp -d)"
RAW_DIR="$WORK_DIR/raw"
OUT_DIR="$WORK_DIR/out"
mkdir -p "$RAW_DIR" "$OUT_DIR"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

CUSTOM_DUMP_NAME="${BACKUP_PREFIX}_${TIMESTAMP_UTC}.dump"
SCHEMA_SQL_NAME="${BACKUP_PREFIX}_${TIMESTAMP_UTC}_schema.sql"
ARCHIVE_NAME="${BACKUP_PREFIX}_${TIMESTAMP_UTC}.tar.gz"
ENCRYPTED_NAME="${ARCHIVE_NAME}.enc"
CHECKSUM_NAME="${ENCRYPTED_NAME}.sha256"

run_pg_dump() {
  local db_url="$1"
  shift

  if [ "$USE_DOCKER_PG_DUMP" = "true" ]; then
    docker run --rm \
      -v "$RAW_DIR:$RAW_DIR" \
      "postgres:${PG_DUMP_DOCKER_TAG}" \
      pg_dump "$@" "$db_url"
    return
  fi

  pg_dump "$@" "$db_url"
}

dump_database() {
  local db_url="$1"

  run_pg_dump "$db_url" \
    --no-owner \
    --no-privileges \
    --format=custom \
    --compress=9 \
    --file "$RAW_DIR/$CUSTOM_DUMP_NAME"

  run_pg_dump "$db_url" \
    --no-owner \
    --no-privileges \
    --schema-only \
    --file "$RAW_DIR/$SCHEMA_SQL_NAME"
}

echo "Creating Postgres dumps..."
if ! dump_database "$SUPABASE_BACKUP_DATABASE_URL"; then
  if [ -n "${SUPABASE_BACKUP_DATABASE_URL_FALLBACK:-}" ]; then
    echo "Primary database URL failed. Retrying with fallback URL..."
    rm -f "$RAW_DIR/$CUSTOM_DUMP_NAME" "$RAW_DIR/$SCHEMA_SQL_NAME"
    dump_database "$SUPABASE_BACKUP_DATABASE_URL_FALLBACK"
  else
    echo "Primary database URL failed and no fallback URL is configured." >&2
    exit 1
  fi
fi

echo "Packaging backup..."
tar -C "$RAW_DIR" -czf "$OUT_DIR/$ARCHIVE_NAME" .

echo "Encrypting backup artifact..."
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$OUT_DIR/$ARCHIVE_NAME" \
  -out "$OUT_DIR/$ENCRYPTED_NAME" \
  -pass env:SUPABASE_BACKUP_ENCRYPTION_PASSPHRASE

sha256sum "$OUT_DIR/$ENCRYPTED_NAME" > "$OUT_DIR/$CHECKSUM_NAME"

BACKUP_REPO_DIR="$WORK_DIR/backup-repo"
BACKUP_REPO_URL_PRIMARY="https://x-access-token:${BACKUP_TOKEN}@github.com/${BACKUP_REPO}.git"
BACKUP_REPO_URL_FALLBACK="https://${BACKUP_GIT_USERNAME}:${BACKUP_TOKEN}@github.com/${BACKUP_REPO}.git"
BACKUP_REPO_URL="$BACKUP_REPO_URL_PRIMARY"
BACKUP_API_URL="https://api.github.com/repos/${BACKUP_REPO}"

echo "Validating GitHub backup target access (${BACKUP_REPO})..."
GITHUB_REPO_CHECK_CODE="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${BACKUP_TOKEN}" \
    "https://api.github.com/repos/${BACKUP_REPO}"
)"
if [ "$GITHUB_REPO_CHECK_CODE" != "200" ]; then
  echo "Backup repo access check failed (HTTP ${GITHUB_REPO_CHECK_CODE}) for ${BACKUP_REPO}." >&2
  echo "Verify SUPABASE_BACKUP_REPO and SUPABASE_BACKUP_REPO_TOKEN secrets." >&2
  exit 1
fi

if ! git ls-remote --exit-code --heads "$BACKUP_REPO_URL" "$BACKUP_BRANCH" >/dev/null 2>&1; then
  if git ls-remote --exit-code --heads "$BACKUP_REPO_URL_FALLBACK" "$BACKUP_BRANCH" >/dev/null 2>&1; then
    echo "Primary git auth format failed. Retrying with username/token auth."
    BACKUP_REPO_URL="$BACKUP_REPO_URL_FALLBACK"
  fi
fi

echo "Pushing encrypted backup to ${BACKUP_REPO}..."
if ! git ls-remote --exit-code --heads "$BACKUP_REPO_URL" "$BACKUP_BRANCH" >/dev/null 2>&1; then
  DEFAULT_REMOTE_BRANCH="$(
    curl -sS \
      -H "Authorization: Bearer ${BACKUP_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      "${BACKUP_API_URL}" \
      | sed -n 's/.*"default_branch"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      | head -n1
  )"
  if [ -n "$DEFAULT_REMOTE_BRANCH" ]; then
    echo "Branch '$BACKUP_BRANCH' not found. Falling back to remote default branch '$DEFAULT_REMOTE_BRANCH'."
    BACKUP_BRANCH="$DEFAULT_REMOTE_BRANCH"
  else
    echo "Unable to resolve backup branch '$BACKUP_BRANCH' and no remote default branch found." >&2
    exit 1
  fi
fi

TARGET_DIR="backups/$YEAR/$MONTH/$DAY"
API_UPLOAD_MODE="false"

if ! git clone --depth 1 --branch "$BACKUP_BRANCH" "$BACKUP_REPO_URL" "$BACKUP_REPO_DIR"; then
  echo "Git clone failed, switching to GitHub Contents API upload mode."
  API_UPLOAD_MODE="true"
fi

if [ "$API_UPLOAD_MODE" = "false" ]; then
  TARGET_ABS_DIR="$BACKUP_REPO_DIR/$TARGET_DIR"
else
  TARGET_ABS_DIR="$WORK_DIR/api-stage/$TARGET_DIR"
fi

mkdir -p "$TARGET_ABS_DIR"
cp "$OUT_DIR/$ENCRYPTED_NAME" "$TARGET_ABS_DIR/"
cp "$OUT_DIR/$CHECKSUM_NAME" "$TARGET_ABS_DIR/"

cat > "$TARGET_ABS_DIR/${BACKUP_PREFIX}_${TIMESTAMP_UTC}.metadata.json" <<EOF
{
  "timestamp_utc": "${TIMESTAMP_UTC}",
  "format": "pg_dump custom + schema SQL",
  "encrypted_file": "${ENCRYPTED_NAME}",
  "checksum_file": "${CHECKSUM_NAME}"
}
EOF

if [ "$API_UPLOAD_MODE" = "true" ]; then
  upload_file() {
    local file_path="$1"
    local remote_path="$2"
    local b64
    b64="$(base64 -w 0 "$file_path")"
    local payload
    payload="$(python3 - <<PY
import json
print(json.dumps({
  "message": "backup: ${BACKUP_PREFIX} ${TIMESTAMP_UTC} UTC",
  "branch": "${BACKUP_BRANCH}",
  "content": "${b64}"
}))
PY
)"
    local code
    code="$(curl -sS -o /tmp/itemtraxx_backup_api_resp.json -w "%{http_code}" \
      -X PUT \
      -H "Authorization: Bearer ${BACKUP_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/json" \
      "${BACKUP_API_URL}/contents/${remote_path}" \
      --data "$payload")"
    if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
      echo "GitHub API upload failed for ${remote_path} (HTTP ${code})" >&2
      cat /tmp/itemtraxx_backup_api_resp.json >&2
      exit 1
    fi
  }

  upload_file "$TARGET_ABS_DIR/$ENCRYPTED_NAME" "$TARGET_DIR/$ENCRYPTED_NAME"
  upload_file "$TARGET_ABS_DIR/$CHECKSUM_NAME" "$TARGET_DIR/$CHECKSUM_NAME"
  upload_file "$TARGET_ABS_DIR/${BACKUP_PREFIX}_${TIMESTAMP_UTC}.metadata.json" "$TARGET_DIR/${BACKUP_PREFIX}_${TIMESTAMP_UTC}.metadata.json"
  echo "Backup complete: ${ENCRYPTED_NAME} (uploaded via GitHub API)"
  exit 0
fi

pushd "$BACKUP_REPO_DIR" >/dev/null
git config user.name "itemtraxx-backup-bot"
git config user.email "support@itemtraxx.com"
git add "$TARGET_DIR"
if git diff --cached --quiet; then
  echo "No backup changes to commit."
  exit 0
fi
git commit -m "backup: ${BACKUP_PREFIX} ${TIMESTAMP_UTC} UTC"
git push origin "$BACKUP_BRANCH"
popd >/dev/null

echo "Backup complete: ${ENCRYPTED_NAME}"
