# Incident Response Guide

## Purpose
Use this guide for customer-impacting outages, degradations, or security incidents.

## Severity
- P1: Core workflows unavailable for multiple tenants (login, checkout, admin panel).
- P2: Major degradation with workarounds or limited tenant scope.
- P3: Partial feature issue with low operational impact.

## Roles
- Incident Commander: owns timeline, decisions, and status updates.
- Communications Lead: publishes internal/external updates.
- Technical Lead: drives investigation and mitigation.
- Scribe: logs timestamps, actions, and decisions.

## Initial 15 Minutes
1. Acknowledge and create incident channel/ticket.
2. Assign all incident roles.
3. Reproduce and determine blast radius.
4. Decide customer status impact level.
5. Publish first update with known facts.

## Investigation Workflow
1. Confirm whether issue is app, infrastructure, auth, DNS/network, or external provider.
2. Gather hard evidence:
   - request IDs
   - routes
   - edge function names
   - tenant IDs (if scoped)
   - timestamps (PT + UTC)
3. Form one primary hypothesis and one fallback hypothesis.
4. Test mitigations in smallest safe scope first.
5. Escalate to rollback if mitigation confidence is low.

## Communication Cadence
- P1: every 30 minutes.
- P2: every 60 minutes.
- P3: start + major updates + resolution.

## Required Status Update Fields
- What users experience.
- Scope (who is affected).
- Current hypothesis.
- Mitigation in progress.
- Next update time.

## Resolution Criteria
- Error rates stable at baseline for 30+ minutes.
- Critical user flows validated end-to-end.
- No active high-severity alerts.
- Final customer update posted.

## Post-Incident (within 48 hours)
1. Publish timeline with concrete timestamps.
2. Document root cause and contributing factors.
3. Add preventive actions with owners and due dates.
4. Update runbooks and detection rules.
