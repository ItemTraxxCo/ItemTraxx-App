# Failure Injection Drills

## Drill 1: Tenant Write Block During Maintenance
- Enable maintenance mode in super admin.
- Verify write actions fail with expected message.
- Verify maintenance UX appears on protected routes.

## Drill 2: Suspended Tenant Enforcement
- Suspend tenant from super admin.
- Verify tenant login blocked.
- Verify admin write actions return `Tenant disabled`.

## Drill 3: Super Dashboard Dependency Failure
- Temporarily misconfigure one super endpoint in staging.
- Verify alerting and graceful fallback handling.

## Drill 4: Edge Proxy Rejection
- Remove one function from worker allowlist in staging.
- Verify client error handling and log correlation via `x-request-id`.

## Exit Criteria
- Detection, triage, and recovery completed within target SLO.
- Gaps converted into tracked engineering tasks.
