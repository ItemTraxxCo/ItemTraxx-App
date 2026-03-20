# Runbook: Cloudflare Worker Deploy

## Purpose

Deploy the ItemTraxx Cloudflare edge proxy worker safely.

## Preconditions

- Wrangler installed.
- Wrangler authenticated.
- Developer has access to the correct Cloudflare account.

## Preferred Manual Deploy Commands

From the repo root:

```bash
npm run deploy:cloudflare:worker
```

Or directly:

```bash
bash ./scripts/deploy-cloudflare-worker.sh
```

## Repo Script

File:

- `scripts/deploy-cloudflare-worker.sh`

Behavior:

- resolves the repo root dynamically
- changes into `cloudflare/edge-proxy`
- runs `npx wrangler deploy`

This means the deploy is not tied to any one developer home directory.

## Current Worker Location

- `cloudflare/edge-proxy/src/index.ts`
- `cloudflare/edge-proxy/wrangler.toml`

## Post-Deploy Verification

1. Confirm Wrangler reports a successful deployment.
2. Check the worker URL directly if appropriate.
3. Verify the app can still call expected proxied functions.
4. Verify no unexpected origin-blocking or CORS regressions.

## Rollback Strategy

1. Check out the last known good worker revision.
2. Re-run the worker deploy command.
3. Verify affected public routes and auth flows.
