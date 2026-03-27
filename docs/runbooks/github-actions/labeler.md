# Labeler

## Purpose
Applies pull request labels based on changed paths.

## Trigger
- `pull_request_target`

## Behavior
- Uses `.github/labeler.yml`
- Runs with pull request write permission
- Sends Slack start/finish notifications

## Failure Handling
Check the `label` job and validate `.github/labeler.yml` syntax and path rules. Because this runs on `pull_request_target`, treat changes carefully.
