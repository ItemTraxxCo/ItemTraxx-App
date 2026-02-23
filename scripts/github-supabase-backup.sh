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

BACKUP_BRANCH="${SUPABASE_BACKUP_REPO_BRANCH:-main}"
BACKUP_PREFIX="${SUPABASE_BACKUP_PREFIX:-supabase}"
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

echo "Creating Postgres dumps..."
pg_dump \
  --no-owner \
  --no-privileges \
  --format=custom \
  --compress=9 \
  --file "$RAW_DIR/$CUSTOM_DUMP_NAME" \
  "$SUPABASE_BACKUP_DATABASE_URL"

pg_dump \
  --no-owner \
  --no-privileges \
  --schema-only \
  --file "$RAW_DIR/$SCHEMA_SQL_NAME" \
  "$SUPABASE_BACKUP_DATABASE_URL"

echo "Packaging backup..."
tar -C "$RAW_DIR" -czf "$OUT_DIR/$ARCHIVE_NAME" .

echo "Encrypting backup artifact..."
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$OUT_DIR/$ARCHIVE_NAME" \
  -out "$OUT_DIR/$ENCRYPTED_NAME" \
  -pass env:SUPABASE_BACKUP_ENCRYPTION_PASSPHRASE

sha256sum "$OUT_DIR/$ENCRYPTED_NAME" > "$OUT_DIR/$CHECKSUM_NAME"

BACKUP_REPO_DIR="$WORK_DIR/backup-repo"
BACKUP_REPO_URL="https://x-access-token:${SUPABASE_BACKUP_REPO_TOKEN}@github.com/${SUPABASE_BACKUP_REPO}.git"

echo "Pushing encrypted backup to ${SUPABASE_BACKUP_REPO}..."
git clone --depth 1 --branch "$BACKUP_BRANCH" "$BACKUP_REPO_URL" "$BACKUP_REPO_DIR"

TARGET_DIR="$BACKUP_REPO_DIR/backups/$YEAR/$MONTH/$DAY"
mkdir -p "$TARGET_DIR"
cp "$OUT_DIR/$ENCRYPTED_NAME" "$TARGET_DIR/"
cp "$OUT_DIR/$CHECKSUM_NAME" "$TARGET_DIR/"

cat > "$TARGET_DIR/${BACKUP_PREFIX}_${TIMESTAMP_UTC}.metadata.json" <<EOF
{
  "timestamp_utc": "${TIMESTAMP_UTC}",
  "format": "pg_dump custom + schema SQL",
  "encrypted_file": "${ENCRYPTED_NAME}",
  "checksum_file": "${CHECKSUM_NAME}"
}
EOF

pushd "$BACKUP_REPO_DIR" >/dev/null
git config user.name "itemtraxx-backup-bot"
git config user.email "support@itemtraxx.com"
git add "backups/$YEAR/$MONTH/$DAY"
git commit -m "backup: ${BACKUP_PREFIX} ${TIMESTAMP_UTC} UTC"
git push origin "$BACKUP_BRANCH"
popd >/dev/null

echo "Backup complete: ${ENCRYPTED_NAME}"
