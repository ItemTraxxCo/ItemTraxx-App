# Slack Notify Failure

## Purpose
Reusable workflow for simple Slack failure notifications.

## Trigger
- `workflow_call` only

## Inputs
- `workflow_name`
- `job_name`
- `run_url`
- `ref_name`
- `sha`

## Required Secrets
- `SLACK_WEBHOOK_URL`

## Behavior
- Sends a structured Slack message for a failed workflow/job
- Uses webhook delivery only

## Notes
This is an internal reusable workflow. It is not intended to be run directly from the Actions UI.
