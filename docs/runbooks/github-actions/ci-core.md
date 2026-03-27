# CI Core

## Purpose
Runs the main build and verification checks for pull requests and key branches.

## Trigger
- Any pull request
- Push to `main`
- Push to `preview`

## Behavior
- Runs `npm ci`
- Verifies environment parity with `scripts/check-env-parity.sh`
- Builds the app
- Enforces bundle and image budgets
- Generates and uploads a perf report artifact
- Sends Slack start/finish notifications through the shared status workflow

## Key Artifacts
- `artifacts/perf-report.json`

## Failure Handling
Start with the failing step in `build-and-verify`. The most common failures are build breaks, perf budget regressions, or environment drift.
