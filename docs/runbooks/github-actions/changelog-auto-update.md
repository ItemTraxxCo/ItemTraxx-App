# Changelog Auto Update

## Purpose
Automatically updates `CHANGELOG.md` from commit subjects after pushes to `main`.

## Trigger
- Push to `main`

## Required Permissions and Secrets
- Repository `contents: write` permission
- Slack secrets if notifications are desired

## Behavior
- Checks out full git history
- Runs `node ./scripts/update-changelog-from-commits.mjs`
- Commits and pushes `CHANGELOG.md` back to `main` as `github-actions[bot]`
- Skips execution if the actor is already `github-actions[bot]`

## Failure Handling
Review the `Update CHANGELOG.md from commit subjects` step or the final push step. Typical issues are malformed changelog generation or branch protection conflicts.
