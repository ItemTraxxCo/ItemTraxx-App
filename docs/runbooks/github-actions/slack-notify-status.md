# Slack Notify Status

## Purpose
Reusable workflow for start/finish Slack status notifications across GitHub Actions workflows.

## Trigger
- `workflow_call` only

## Inputs
- `mode`
- `workflow_name`
- `job_name`
- `run_url`
- `ref_name`
- `sha`
- optional: `status`, `slack_channel_id`, `slack_message_ts`

## Supported Secrets
- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID`
- `SLACK_WEBHOOK_URL`

## Behavior
- `mode: start` posts a start message
- `mode: finish` updates the same Slack message when bot-token mode is available
- Falls back to webhook posting when bot-token posting fails or is not configured
- Produces colored status attachments for started, succeeded, failed, and cancelled states

## Notes
This is an internal reusable workflow. It is not intended to be run directly from the Actions UI.
