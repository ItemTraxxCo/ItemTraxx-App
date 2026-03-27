# Deploy Cloudflare Worker

## Purpose
Deploys the Cloudflare edge proxy from GitHub Actions using the repo-pinned Wrangler CLI.

## Trigger
- Push to `main` when one of these paths changes:
  - `cloudflare/edge-proxy/**`
  - `scripts/deploy-cloudflare-worker.sh`
  - `.github/workflows/deploy-cloudflare-worker.yml`
- Manual: `workflow_dispatch`

## Required Secrets
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- Slack secrets if notifications are desired

## Behavior
- Runs `npm ci`
- Executes `./scripts/deploy-cloudflare-worker.sh`
- Uses the repo-managed `wrangler` version via `npx`

## Failure Handling
Check the `Deploy worker` step first. Common issues are invalid Cloudflare credentials, Worker build failures, or Wrangler regressions.
