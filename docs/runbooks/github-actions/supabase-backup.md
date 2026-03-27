# Supabase Backup

## Purpose
Creates encrypted production backups on a schedule and stores them in the configured backup repository.

## Trigger
- Scheduled: `35 6,18 * * *` UTC
- Manual: `workflow_dispatch`

## Required Secrets
- `SUPABASE_BACKUP_DATABASE_URL`
- `SUPABASE_BACKUP_DATABASE_URL_FALLBACK`
- `SUPABASE_BACKUP_REPO`
- `SUPABASE_BACKUP_REPO_TOKEN`
- `SUPABASE_BACKUP_ENCRYPTION_PASSPHRASE`
- `SUPABASE_BACKUP_REPO_BRANCH`
- Slack secrets if notifications are desired

## Behavior
- Verifies Docker availability
- Runs `./scripts/github-supabase-backup.sh`
- Uses Docker-based `pg_dump` with retention settings from the workflow env
- Sends Slack start/finish notifications

## Failure Handling
Check Docker availability first, then the backup script logs. Common failures are database connectivity, backup repo auth issues, or encryption/retention misconfiguration.
