# E2E Tests

## Purpose
Runs Playwright browser tests for pull requests and key branches.

## Trigger
- Any pull request
- Push to `main`
- Push to `preview`

## Behavior
- Runs `npm ci`
- Installs Playwright Chromium and dependencies
- Executes `npm run test:e2e`
- Uploads Playwright artifacts on every run
- Sends Slack start/finish notifications

## Key Artifacts
- `playwright-report`
- `test-results`

## Failure Handling
Inspect the Playwright report artifact first. Most failures are caused by UI regressions, auth harness drift, or route/content timing changes.
