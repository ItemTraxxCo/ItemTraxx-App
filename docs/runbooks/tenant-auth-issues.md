# Runbook: Tenant Auth Issues

## Symptoms
- Login fails with generic error.
- Edge functions return `401 Invalid JWT`.
- Slow login with profile lookup timeout.

## Triage Checklist
1. Confirm user role (`tenant_user` or `tenant_admin`).
2. Capture failing route and exact timestamp.
3. Inspect console/network for:
   - `401` from edge functions
   - profile fetch timeouts
   - token refresh errors

## Common Root Causes
- Expired or invalid Supabase access token.
- Edge function deployed with wrong JWT verification mode.
- Session state stale in local storage.
- Role/profile lookup timeout causing downstream failures.

## Debug Commands
```bash
# run app locally
npm run dev

# verify build sanity
npm run build
```

## Recovery Steps
1. Force sign-out and sign-in to refresh token.
2. Verify role profile row exists and is queryable.
3. Validate edge function auth mode for affected function.
4. Confirm frontend is sending Authorization bearer token.
5. Re-test from clean browser profile.

## Validation
- Tenant user can login and complete checkout.
- Tenant admin can login and load admin list views.
- No repeated `401 Invalid JWT` on normal flows.
