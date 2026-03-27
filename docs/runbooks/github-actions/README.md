# GitHub Actions Workflow Runbooks

This directory contains a dedicated runbook for each GitHub Actions workflow in the repository.

## Infrastructure and Scheduled Operations
- `docs/runbooks/github-actions/async-job-worker.md` — Scheduled async job processing.
- `docs/runbooks/github-actions/deployment-health.md` — Scheduled health and header checks.
- `docs/runbooks/github-actions/synthetic-journeys.md` — Scheduled synthetic smoke tests.
- `docs/runbooks/github-actions/supabase-backup.md` — Scheduled encrypted Supabase backups.
- `docs/runbooks/github-actions/schedule-watchdog.md` — Stale scheduled workflow detection.
- `docs/runbooks/github-actions/deploy-cloudflare-worker.md` — Cloudflare worker deployment workflow.
- `docs/runbooks/github-actions/deploy-supabase-functions.md` — Supabase Edge Function deployment workflow.
- `docs/runbooks/github-actions/vercel-analytics-report.md` — Weekly Vercel analytics reporting.

## CI and Quality Gates
- `docs/runbooks/github-actions/ci-core.md` — Build, env parity, and perf budget checks.
- `docs/runbooks/github-actions/e2e-tests.md` — Playwright E2E checks.
- `docs/runbooks/github-actions/security-audit.md` — Security gate and SBOM generation.
- `docs/runbooks/github-actions/codeql.md` — CodeQL analysis.
- `docs/runbooks/github-actions/changelog-auto-update.md` — Automatic changelog updates on `main`.
- `docs/runbooks/github-actions/labeler.md` — Pull request labeling.

## Shared Notification Workflows
- `docs/runbooks/github-actions/slack-notify-status.md` — Reusable live Slack status workflow.
- `docs/runbooks/github-actions/slack-notify-failure.md` — Reusable Slack failure notification workflow.
