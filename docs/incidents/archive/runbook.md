# Incident Runbook

## Severity Levels
- P1: login/checkout unavailable for all tenants.
- P2: major role/path degraded without broad outage.
- P3: partial feature degradation with workaround.

## Immediate Actions
1. Acknowledge incident and assign an owner.
2. Confirm blast radius (tenant-only, role-only, global).
3. Collect request IDs, timestamps, and affected routes.
4. Decide: mitigate forward or rollback.
5. Post status update if customer-facing.

## Communication Cadence
- P1: every 30 minutes
- P2: every 60 minutes
- P3: at start + resolution

## Resolution Checklist
- Verify all critical routes and auth flows.
- Confirm no sustained 5xx in edge functions.
- Confirm status page updated.
- Write postmortem and remediation tasks.
