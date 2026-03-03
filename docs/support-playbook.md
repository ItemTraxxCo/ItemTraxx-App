# Support Playbook

## Intake Data Required
- User email and role.
- Tenant name.
- Affected route.
- Local timestamp and timezone.
- Screenshot of error and console/network snippet.

## First Response Targets
- P1: within 15 minutes.
- P2: within 1 hour.
- P3: within 1 business day.

## Standard Triage Buckets
- Auth/session issues.
- Edge function 401/500.
- DNS/network blocking.
- UI regressions.
- Data loading/performance.

## Fast Checks
1. Confirm system status page.
2. Confirm recent deploys and CI health.
3. Validate reproduction in local and production.
4. Determine single-tenant vs multi-tenant impact.

## Escalation Criteria
Escalate immediately if:
- multiple tenants blocked
- login unavailable
- data mutation failing globally
- suspected security incident

## Resolution Communication
Every update should include:
- what is known
- what changed since last update
- next action + ETA
