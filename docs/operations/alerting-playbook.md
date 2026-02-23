# Alerting Playbook

## Signals
- `deployment-health` workflow failure
- login endpoint failures (`tenant-login`, `admin login`)
- elevated 5xx from edge functions
- `system-status` degraded/down status

## Correlation Strategy
- Every edge request includes `x-request-id`.
- Cloudflare edge proxy forwards request IDs to Supabase functions.
- Function logs include `request_id` on fatal errors.

## Triage Steps
1. Confirm impact scope (tenant-only vs global vs super-admin-only).
2. Collect failing `x-request-id` from response headers/network panel.
3. Search Supabase/worker logs using that ID.
4. Determine blast radius and trigger rollback if needed.
5. Post status update if user-facing impact exists.

## Escalation Rules
- P1: login outage or checkout/return outage > 5 min.
- P2: single-role outage with workaround.
- P3: non-blocking feature degradation.

## Recovery Checklist
- Verify landing/login/checkout/super-auth/super-admin routes.
- Verify maintenance and broadcast banners still render.
- Verify edge function health responses and no sustained 5xx.
