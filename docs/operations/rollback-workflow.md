# Rollback Workflow

## Trigger Conditions
- Checkout/auth flow break in production
- Elevated 5xx or login failures
- CSP/header regression affecting route access

## Rollback Steps
1. Identify last known good commit on `main`.
2. In Vercel, redeploy that deployment immediately.
3. Re-deploy Cloudflare edge proxy from matching commit if worker changes were included.
4. Re-deploy affected Supabase edge functions from matching commit if function changes were included.
5. Run health checks:
   - `/`
   - `/login`
   - `/tenant/checkout`
   - `/super-auth`
6. Post incident note with root cause and forward-fix plan.

## Required Evidence
- Failing symptom screenshot or URL
- Rollback deployment IDs
- Header and status endpoint output timestamps
