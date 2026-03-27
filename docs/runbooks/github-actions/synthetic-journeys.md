# Synthetic Journeys

## Purpose
Runs scheduled production smoke checks against key user journeys.

## Trigger
- Scheduled: `7,37 * * * *` UTC
- Manual: `workflow_dispatch`

## Behavior
- Checks out the repo
- Runs `bash ./scripts/synthetic-smoke.sh`
- Sends Slack start/finish notifications

## Failure Handling
Inspect the script output first. Failures usually indicate public route regressions, auth/redirect breakage, or upstream availability issues.
