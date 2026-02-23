# Supabase Backup Automation (GitHub Actions)

This project includes a daily automated backup workflow:

- Workflow: `.github/workflows/supabase-backup.yml`
- Script: `scripts/github-supabase-backup.sh`
- Schedule: daily at `06:35 UTC`
- Output: encrypted backup artifacts pushed to a private GitHub repo

## What gets backed up

Each run creates:

1. Postgres custom-format dump (`.dump`) with schema + data.
2. Schema-only SQL dump (`_schema.sql`).
3. `tar.gz` package of both files.
4. AES-256 encrypted artifact (`.tar.gz.enc`) + SHA-256 checksum.

Only encrypted artifacts are committed to the backup repository.

## Required GitHub secrets (in this app repo)

1. `SUPABASE_BACKUP_DATABASE_URL`
   - Postgres connection string for the Supabase database.
   - Prefer a dedicated backup user with least privilege required for dump.
2. `SUPABASE_BACKUP_DATABASE_URL_FALLBACK` (optional but recommended)
   - Fallback Postgres URI used when the primary host is unreachable from GitHub runners.
   - Recommended: Supabase Session Pooler connection string (IPv4-friendly).
3. `SUPABASE_BACKUP_REPO`
   - Format: `ItemTraxxCo/<private-backup-repo-name>`
4. `SUPABASE_BACKUP_REPO_TOKEN`
   - GitHub PAT with write access to the private backup repo only.
5. `SUPABASE_BACKUP_ENCRYPTION_PASSPHRASE`
   - Strong passphrase used for backup encryption.
6. `SUPABASE_BACKUP_REPO_BRANCH` (optional)
   - Defaults to `main` if omitted.

## Runtime notes

- The workflow runs `pg_dump` via Docker image `postgres:17` to avoid client/server version mismatch on GitHub runners.
- Backup retention is set to 365 days (1 year) by default in workflow env.
- Optional script env toggles:
  - `SUPABASE_BACKUP_USE_DOCKER_PG_DUMP` (default: `false`)
  - `SUPABASE_BACKUP_PG_DUMP_TAG` (default: `17`)
  - `SUPABASE_BACKUP_RETENTION_DAYS` (default: `365`)

## Restore basics

1. Download `.enc` and `.sha256` from backup repo.
2. Verify checksum:
   - `sha256sum -c <file>.sha256`
3. Decrypt:
   - `openssl enc -d -aes-256-cbc -pbkdf2 -in <file>.enc -out backup.tar.gz -pass env:SUPABASE_BACKUP_ENCRYPTION_PASSPHRASE`
4. Extract:
   - `tar -xzf backup.tar.gz`
5. Restore custom dump:
   - `pg_restore --clean --if-exists --no-owner --no-privileges -d <target_db_url> <file>.dump`

## Notes

- This flow backs up database schema + data.
- Supabase Storage objects are not included in this workflow.
