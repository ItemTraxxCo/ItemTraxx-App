# Runbook: Edge Function Deploy

## Purpose
Deploy Supabase edge functions safely and verify auth behavior.

## Preconditions
- Supabase CLI installed and authenticated.
- Correct project ref selected.
- Required secrets set in Supabase project.

## Deploy Commands
```bash
# deploy a single function
supabase functions deploy <function_name>

# deploy function with JWT verification disabled at gateway
# use only if function performs auth validation internally
supabase functions deploy <function_name> --no-verify-jwt
```

## Typical Functions
- `admin-ops`
- `admin-student-mutate`
- `checkoutReturn`
- `login-notify`

## Post-Deploy Verification
1. Confirm deploy output shows success.
2. Hit function through app flow, not only direct curl.
3. Check for expected auth behavior:
   - protected endpoints reject missing/invalid tokens
   - valid tenant flows return 2xx
4. Confirm no spike in 401/500 in logs.

## Rollback Strategy
1. Re-deploy last known good function revision from git.
2. Re-run smoke tests for affected route.
3. Update incident/status notes if user impact occurred.
