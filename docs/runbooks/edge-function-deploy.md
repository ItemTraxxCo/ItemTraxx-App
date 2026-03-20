# Runbook: Edge Function Deploy

## Purpose

Deploy Supabase edge functions safely and verify auth behavior.

## Preconditions

- Supabase CLI installed.
- Supabase CLI authenticated.
- Correct project ref known if the local CLI is not already linked.
- Required Supabase secrets already set in the target project.

## Preferred Manual Deploy Commands

From the repo root, deploy all tracked functions:

```bash
npm run deploy:supabase:functions
```

Deploy only specific functions:

```bash
npm run deploy:supabase:functions -- tenant-login login-notify
```

Call the deploy script directly:

```bash
python3 ./scripts/deploy-supabase-functions.py tenant-login login-notify
```

Target a specific project ref explicitly:

```bash
SUPABASE_PROJECT_REF=<project-ref> python3 ./scripts/deploy-supabase-functions.py tenant-login
```

## How The Repo Deploy Script Works

File:

- `scripts/deploy-supabase-functions.py`

Behavior:

- discovers tracked functions under `supabase/functions/`
- reads `supabase/config.toml`
- automatically adds `--no-verify-jwt` for functions configured with `verify_jwt = false`
- can deploy all functions or only the names you pass in

## Legacy Direct CLI Commands

These still work when needed.

```bash
supabase functions deploy <function_name>
```

```bash
supabase functions deploy <function_name> --no-verify-jwt
```

Use the repo deploy script unless you have a specific reason not to.

## Post-Deploy Verification

1. Confirm deploy output shows success.
2. Hit the function through the app flow, not only direct curl.
3. Check expected auth behavior:
- protected endpoints reject missing or invalid tokens
- valid tenant flows return 2xx
4. Confirm there is no spike in 401 or 500 responses.

## Rollback Strategy

1. Check out the last known good revision.
2. Re-deploy the affected function or functions.
3. Re-run smoke tests for the affected route.
4. Update incident or status communication if users were impacted.
