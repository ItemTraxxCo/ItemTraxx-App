# RBAC / Security Threat Model Notes (2026-02-23)

## Scope
- Frontend route/role guards in `/src/router/index.ts` and auth state handling.
- Edge-function authorization patterns under `/supabase/functions/*`.
- Tenant/super-admin mutation paths and cross-tenant data access controls.
- RLS posture for tenant and super-admin operational tables.

## Trust Boundaries
- Browser clients are untrusted; all role/tenant enforcement must happen server-side.
- Cloudflare worker proxy forwards auth headers but is not an authorization layer.
- Supabase edge functions are the authorization decision points for write APIs.
- Supabase RLS is the enforcement boundary for direct client table queries.

## Key Risks Identified
1. Dynamic PostgREST `.or(...)` filter strings used unsanitized user input in super and student flows.
2. `admin-ops` did not consistently enforce tenant-admin active status and tenant suspension for write actions.
3. RLS hardening not codified as an explicit baseline script for core tenant/super tables.
4. 404 diagnostics displayed tenant/user metadata in production responses.

## Remediations Applied
1. Removed unsanitized dynamic `.or(...)` filter usage from:
- `/supabase/functions/super-gear-mutate/index.ts`
- `/supabase/functions/super-student-mutate/index.ts`
- `/supabase/functions/super-tenant-mutate/index.ts`
- `/supabase/functions/admin-student-mutate/index.ts`

2. Hardened `admin-ops` auth consistency:
- Added `profiles.is_active` check for tenant admin callers.
- Added tenant suspension checks for tenant write actions (`update_tenant_settings`, `bulk_import_gear`).
- Standardized error path to preserve CORS/json response shape.

3. Added explicit RLS hardening SQL baseline:
- `/supabase/sql/rbac_hardening.sql`
- Includes helper identity functions and table-level policies for tenant/super-admin scope.

4. Reduced production metadata leakage on 404:
- `/src/pages/NotFound.vue` now shows role/tenant/user diagnostics only in development.

## Residual Risks / Follow-ups
- Apply `/supabase/sql/rbac_hardening.sql` in production and verify with test accounts.
- Validate no legacy DB policies conflict with the new baseline before applying in prod.
- Consider moving repeated edge auth checks into shared helper modules to reduce drift.
- Add negative authorization E2E tests (cross-tenant access, suspended tenant write attempts).
