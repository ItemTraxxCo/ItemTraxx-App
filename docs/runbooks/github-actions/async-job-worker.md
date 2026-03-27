# Async Job Worker

## Purpose
Runs the production async job worker on a schedule or manually.

## Trigger
- Scheduled: `3,13,23,33,43,53 * * * *` UTC
- Manual: `workflow_dispatch`

## Required Secrets
- `ITX_JOB_WORKER_SECRET`
- Slack secrets if notifications are desired

## Behavior
- Calls `https://edge.itemtraxx.com/functions/job-worker`
- Sends `{"limit":30,"run_reporting_refresh":true}`
- Uses the shared Slack status workflow for start/finish notifications

## Failure Handling
Check the `process-jobs` step first. Common failures are invalid worker secret, edge proxy outage, or job-worker function errors.
