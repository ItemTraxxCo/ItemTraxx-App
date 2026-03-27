# Schedule Watchdog

## Purpose
Detects stale scheduled workflows and alerts when expected scheduled runs stop happening.

## Trigger
- Scheduled: `11,26,41,56 * * * *` UTC
- Manual: `workflow_dispatch`

## Monitored Workflows and Thresholds
- `Async Job Worker` — 30 minutes
- `Synthetic Journeys` — 90 minutes
- `Deployment Health` — 120 minutes
- `Supabase Backup` — 14 hours

## Required Secrets
- `GITHUB_TOKEN` (provided automatically)
- `SLACK_WEBHOOK_URL` for alert delivery

## Behavior
- Calls the GitHub Actions API for the latest scheduled runs on `main`
- Looks for the latest successful scheduled execution of each monitored workflow
- Fails the workflow and posts to Slack if any monitored workflow is stale

## Failure Handling
First confirm whether GitHub scheduled runs were delayed or dropped globally. Then verify the monitored workflow still has a valid `schedule` trigger and recent successful runs on `main`.
