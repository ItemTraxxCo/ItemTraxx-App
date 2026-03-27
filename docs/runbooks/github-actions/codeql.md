# CodeQL

## Purpose
Runs GitHub CodeQL analysis for workflow files and JavaScript/TypeScript code.

## Trigger
- Any pull request
- Push to `main`
- Push to `preview`
- Scheduled weekly: `21 9 * * 1` UTC

## Behavior
- Analyzes two matrices: `actions` and `javascript-typescript`
- Builds the app before the JavaScript/TypeScript analysis
- Publishes results to GitHub code scanning
- Sends Slack start/finish notifications

## Failure Handling
Check whether the failure is in initialization, dependency install, build, or the analysis step. Informational CodeQL deprecation warnings do not require immediate action unless they become failures.
