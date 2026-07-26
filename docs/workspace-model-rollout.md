# Workspace model rollout

## Verified schema baseline

The production project was inspected read-only before the migration was written. At the time of inspection it contained 34 public tables, 323 public columns, 65 RLS policies, and 50 public functions. The relevant live data shape was five legacy tenants, four districts, and thirteen profiles. Each district-backed tenant mapped one-to-one; one tenant had no district. No customer values are recorded in this document.

The required CLI dump was attempted with:

```sh
supabase db dump --linked --schema public
```

It could not complete because the linked project requires `SUPABASE_DB_PASSWORD`; the CLI returned `LegacyDbConfigConnectTempRoleError`. The migration therefore isolates compatibility assumptions in guarded `DO` blocks and refuses to guess when a legacy district administrator does not map to exactly one tenant. Before production, an operator must provide the production database password, archive the full schema-only dump, and run the conversion fixture against that dump.

## Session-revoke semantics

Supabase Auth does not expose a supported server API for revoking an arbitrary single session by its session ID. ItemTraxx binds `account_sessions.auth_session_id` to the verified JWT `session_id` claim. Revocation sets `revoked_at`; RLS, edge functions, and the Cloudflare HTTP-session heartbeat then reject that JWT immediately and clear the browser's shared session cookies. The underlying Supabase refresh-token record is not represented as independently deleted. “Revoke all” may additionally use the supported global sign-out path.

## Staging checklist

1. Apply `20260725194622_workspace_model_role_redesign.sql` to staging only.
2. Seed two workspaces with different slugs, one Super Admin, a primary and regular Workspace Admin, and at least two Tenant Accounts.
3. Add both staging workspace origins to the edge proxy `ALLOWED_ORIGINS`, deploy the worker and rewritten functions, and run the SQL, Deno, worker, and Playwright suites.
4. Verify a session from workspace A is redirected away from workspace B's host and cannot read or mutate B through REST, RPC, or an edge function.
5. Verify restricted and all-mode items and borrowers, dashboard overlap counts, quick-return audit values, and a second real browser context being terminated after session revoke.

## Staging verification completed 2026-07-25

The workspace migration and follow-up security, dashboard-RPC, and Primary Workspace Admin integrity migrations were applied to project `nwuhjxicaopkmqydjlas`. Staging now has two workspace slugs, one Super Admin profile, a primary and regular Workspace Admin, three Tenant Account profiles, all/restricted item and borrower fixtures, and one grant of each kind. The staging passwords are random and intentionally undisclosed; use an Admin API password reset before interactive login. A database trigger now rejects a primary-admin assignment unless the target is an active, non-deleted Workspace Admin in that same workspace.

The public anonymous slug lookup returned the expected Alpha workspace with HTTP 200. Seventeen rewritten functions were deployed and reported `ACTIVE`; affected functions were redeployed after the final action-contract, dashboard, session, and naming changes. The post-migration security advisor has no errors. Remaining function warnings are intentional security-definer entry points for public workspace lookup, authenticated role/workspace resolution, and the existing rate limiter; the four service-only tables report informational “RLS enabled, no policy” notices because their grants are revoked from `anon` and `authenticated`. Staging also reports that Supabase Auth leaked-password protection is disabled; enable that project setting before treating staging as a production-equivalent auth configuration.

Staging does not currently have the Cloudflare preview worker, exact staging origins, or usable seeded login credentials configured. Consequently the real two-browser session-revocation flow and full four-role browser run remain a release gate rather than a completed claim. Do not treat mocked Playwright coverage as that real-environment proof.

## Workspace provisioning and offboarding

Workspace creation is not self-service. After a Super Admin creates a workspace, add `https://{slug}.app.itemtraxx.com` to the Cloudflare worker's exact origin allowlist and redeploy the worker. During archive/purge, remove that origin and redeploy. Primary Workspace Admin reassignment remains Super Admin-only.

## Production gate

Do not apply this migration or deploy the renamed runtime to production until the full live schema dump has been captured, staging has the complete application baseline, both real-browser contexts pass session revocation, and the production workspace-origin list has been approved. The production release must coordinate database migration, functions, frontend, and Cloudflare worker; partial deployment is intentionally unsupported.
