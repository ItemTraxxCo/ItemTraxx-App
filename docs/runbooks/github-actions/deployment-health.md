# Deployment Health

## Purpose
Performs scheduled production health checks against the public app and status endpoint.

## Trigger
- Scheduled: `29 * * * *` UTC
- Manual: `workflow_dispatch`

## Behavior
- Checks key public URLs for successful responses and required security headers
- Tolerates Cloudflare challenge responses for non-browser CI requests
- Calls the `system-status` function through the Cloudflare edge proxy
- Sends Slack start/finish notifications

## Failure Handling
Review the `Check site and security headers` and `Check status endpoint` steps. Distinguish real outages from temporary Cloudflare challenge behavior.
