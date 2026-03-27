# Vercel Analytics Report

## Purpose
Generates a periodic Vercel analytics report and sends it through the existing reporting path.

## Trigger
- Scheduled weekly: `0 9 * * 1` UTC
- Manual: `workflow_dispatch`
  - Optional input: `period` (`7d`, `14d`, `30d`, etc.)

## Required Secrets
- `VERCEL_API_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_TEAM_ID`
- `SLACK_WEBHOOK_URL`

## Behavior
- Runs `node scripts/vercel-analytics-agent.mjs`
- Pulls analytics for the requested period
- Sends Slack start/finish notifications through the shared status workflow

## Failure Handling
Check the analytics agent step. Common failures are invalid Vercel credentials, bad project/team IDs, or Slack delivery issues in the reporting script.
