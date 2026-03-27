# Runbook: GitHub Actions Deploy Workflows

This runbook explains how to use the two infrastructure deploy workflows in this repository.

For dedicated workflow-by-workflow runbooks, see:

- `docs/runbooks/github-actions/README.md`

Workflows covered:

- `Deploy Supabase Functions`
- `Deploy Cloudflare Worker`
- `Async Job Worker`
- `Synthetic Journeys`
- `Deployment Health`
- `Supabase Backup`
- `Schedule Watchdog`

## 1. Purpose

These workflows let the team deploy infrastructure from GitHub Actions instead of depending on one developer machine.

They are intended to:

- provide a repeatable deploy path
- centralize deploy credentials in GitHub secrets
- allow deploys without any single-developer local path
- keep a normal audit trail in GitHub Actions

## 2. Required GitHub Secrets

These repository secrets must exist before the workflows will work.

### Supabase workflow

Required:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

### Cloudflare workflow

Required:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### Slack notifications

Required for basic Slack posting:

- `SLACK_WEBHOOK_URL`

Required for live status updates in the same Slack message:

- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID`

If only `SLACK_WEBHOOK_URL` is configured:

- Slack still receives notifications
- but each update is a separate message
- and Slack messages cannot be updated in place

## 3. Workflow Files

Supabase functions workflow:

- `.github/workflows/deploy-supabase-functions.yml`

Cloudflare worker workflow:

- `.github/workflows/deploy-cloudflare-worker.yml`

Scheduled operations workflows:

- `.github/workflows/async-job-worker.yml`
- `.github/workflows/synthetic-journeys.yml`
- `.github/workflows/deployment-health.yml`
- `.github/workflows/supabase-backup.yml`
- `.github/workflows/schedule-watchdog.yml`

## 4. Scheduled Workflow Times

These workflows are intentionally staggered to odd-minute offsets in UTC to reduce collisions and scheduler bunching.

- `Async Job Worker`: `3,13,23,33,43,53 * * * *`
- `Synthetic Journeys`: `7,37 * * * *`
- `Deployment Health`: `29 * * * *`
- `Supabase Backup`: `35 6,18 * * *`
- `Schedule Watchdog`: `11,26,41,56 * * * *`

## 5. When These Workflows Run Automatically

### `Deploy Supabase Functions`

This workflow runs automatically on push to `main` when any of these paths change:

- `supabase/functions/**`
- `supabase/config.toml`
- `scripts/deploy-supabase-functions.py`
- `.github/workflows/deploy-supabase-functions.yml`

### `Deploy Cloudflare Worker`

This workflow runs automatically on push to `main` when any of these paths change:

- `cloudflare/edge-proxy/**`
- `scripts/deploy-cloudflare-worker.sh`
- `.github/workflows/deploy-cloudflare-worker.yml`

## 6. How To Run The Workflows Manually

Both workflows support manual execution through GitHub Actions.

### Manual run: Supabase functions

1. Open the GitHub repository.
2. Click `Actions`.
3. In the left sidebar, click:
- `Deploy Supabase Functions`

4. Click:
- `Run workflow`

5. Choose the branch.
6. Optional: fill in the `functions` input.

If you leave the `functions` input blank:
- the workflow deploys all tracked Supabase functions in the repo

If you provide function names in the input:
- enter them space-separated
- example:

```text
tenant-login login-notify job-worker
```

7. Click:
- `Run workflow`

### Manual run: Cloudflare worker

1. Open the GitHub repository.
2. Click `Actions`.
3. In the left sidebar, click:
- `Deploy Cloudflare Worker`

4. Click:
- `Run workflow`

5. Choose the branch.
6. Click:
- `Run workflow`

This workflow does not require any manual input.

## 7. What Each Workflow Actually Does

### `Deploy Supabase Functions`

The workflow:

1. checks out the repository
2. sets up Python
3. installs repo dependencies with `npm ci`
4. reads `SUPABASE_ACCESS_TOKEN`
5. reads `SUPABASE_PROJECT_REF`
6. runs:

```bash
python3 ./scripts/deploy-supabase-functions.py
```

or, if the manual `functions` input is provided, it runs the same script with those function names only

The deploy script:

- discovers tracked functions under `supabase/functions/`
- reads `supabase/config.toml`
- automatically adds `--no-verify-jwt` where needed
- deploys either all functions or only the ones passed in

### `Deploy Cloudflare Worker`

The workflow:

1. checks out the repository
2. sets up Node
3. installs repo dependencies with `npm ci`
4. reads `CLOUDFLARE_API_TOKEN`
5. reads `CLOUDFLARE_ACCOUNT_ID`
6. runs:

```bash
bash ./scripts/deploy-cloudflare-worker.sh
```

That script:

- finds the repo root dynamically
- changes into `cloudflare/edge-proxy`
- runs the repo-pinned `wrangler` CLI via `npx wrangler deploy`

## 8. How To Read The Workflow Result

### Successful result

A successful deploy should show:

- green check mark in Actions
- no auth/token errors
- no missing-secret errors
- provider CLI output indicating successful deployment

### Failed result

If the workflow fails:

1. open the failed run
2. open the failing job
3. inspect the exact failing step
4. fix the actual cause before re-running

Do not re-run blindly without reading the failing step.

## 9. Common Failure Cases

### Supabase: missing or invalid access token

Symptoms:

- authentication failure from Supabase CLI
- unauthorized/project access error

Check:

- `SUPABASE_ACCESS_TOKEN` is present
- token is still valid
- token belongs to a user with access to the correct project

### Supabase: wrong project ref

Symptoms:

- project not found

### Schedule watchdog alert

Symptoms:

- Slack alert from `Schedule Watchdog`
- stale scheduled workflow warning in Actions

Check:

- whether GitHub scheduled runs were delayed or dropped
- whether the referenced workflow still has a valid `schedule` trigger
- whether the last successful run on `main` is older than the watchdog threshold
- deploy targets the wrong project

Check:

- `SUPABASE_PROJECT_REF` matches the intended project reference ID exactly

### Cloudflare: invalid API token

Symptoms:

- Wrangler auth failure
- permission denied
- cannot access account

Check:

- `CLOUDFLARE_API_TOKEN` is present
- token has correct permissions
- token belongs to the intended Cloudflare account

### Cloudflare: wrong account ID

Symptoms:

- Wrangler points at the wrong account
- worker deploy fails with account mismatch

Check:

- `CLOUDFLARE_ACCOUNT_ID` is correct

### Slack notification job fails

Symptoms:

- deploy workflow fails normally
- notification job also fails

Check:

- `SLACK_WEBHOOK_URL` exists
- Slack webhook is still valid

## 9. When To Use Manual Workflow Runs

Use a manual GitHub Actions run when:

- you want to test deploy auth without waiting for a merge
- you want to deploy only one or a few Supabase functions
- you want a GitHub-hosted deploy path instead of a local terminal deploy
- you want a clean audit trail in GitHub Actions

## 10. When Not To Use These Workflows

Do not assume these workflows handle everything.

They do not automatically apply SQL schema changes.

That means:

- files in `supabase/sql/` still require a separate migration process
- function deploy success does not mean the database schema is up to date

If a code change depends on new SQL, that SQL must be applied separately.

## 11. Related Local Manual Commands

The repo also supports manual terminal deploys from any machine.

### Supabase functions

```bash
npm run deploy:supabase:functions
```

Specific functions only:

```bash
npm run deploy:supabase:functions -- tenant-login login-notify
```

### Cloudflare worker

```bash
npm run deploy:cloudflare:worker
```

These do not depend on any single developer home directory.

## 12. Recommended First Verification

Now that the GitHub secrets are set, the recommended first verification is:

1. Manually run `Deploy Supabase Functions`
2. Manually run `Deploy Cloudflare Worker`
3. Confirm both finish successfully
4. Only after that, rely on push-triggered deploys

## 13. Summary

Use these workflows for normal infrastructure deploys through GitHub Actions.

Use local terminal deploys only when:

- you need manual control
- GitHub Actions is unavailable
- you are doing controlled testing
- you are handling an emergency under a runbook


## Slack Live Status Notifications
- Add `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` as GitHub Actions repository secrets to enable start and completion updates in the same Slack message.
- Keep `SLACK_WEBHOOK_URL` if you want a fallback path, but webhook-only mode cannot update an existing Slack message in place.
- The Slack bot token must have the `chat:write` scope for the target channel.
