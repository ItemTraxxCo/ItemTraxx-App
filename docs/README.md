# Docs Index

This directory contains operational, security, architecture, and testing documentation for ItemTraxx.

## Architecture
- `docs/architecture/system-overview.md` — High-level frontend/edge/database architecture and request flows.

## Incidents and Operations
- `docs/incident-response.md` — Incident process, roles, communication cadence, and closure checklist.
- `docs/network-troubleshooting.md` — DNS/firewall/sinkhole troubleshooting commands and escalation flow.
- `docs/support-playbook.md` — Support triage workflow, intake requirements, and escalation criteria.
- `docs/release-checklist.md` — Pre-merge, deploy, smoke-test, and rollback checks.
- `docs/operations/alerting-playbook.md` — Alerting and operational response guidance.
- `docs/operations/async-jobs.md` — Async job architecture and worker operations.
- `docs/operations/rollback-workflow.md` — Rollback procedures.
- `docs/supabase-backups.md` — Backup automation and restore context.

## Runbooks
- `docs/runbooks/tenant-auth-issues.md` — Tenant auth/login/401 troubleshooting.
- `docs/runbooks/edge-function-deploy.md` — Safe edge function deployment and verification.
- `docs/runbooks/kill-switch.md` — Production kill-switch behavior and usage.

## Product and Feature Specs
- `docs/onboarding-feature-spec.md` — First-sign-in onboarding behavior and constraints.
- `docs/offline-queue-design.md` — Offline transaction queue and reconnect sync design.
- `docs/email-templates-guide.md` — Transactional email template structure and checks.
- `docs/tenant-admin-performance-guide.md` — Tenant admin performance tuning guidance.

## Security and Governance
- `docs/security/security-phase2-hardening.md` — Security hardening changes.
- `docs/security/rbac-threat-model-2026-02-23.md` — RBAC threat model.
- `docs/governance/data-governance-lifecycle.md` — Data lifecycle and governance.
- `docs/api/edge-api-contracts.md` — Edge API contracts.

## Testing and Quality
- `docs/testing/e2e-expansion-2026-02-23.md` — E2E coverage expansion notes.
- `docs/accessibility/wcag-2.2-aa-pass-2026-02-23.md` — Accessibility pass summary.
- `docs/performance/frontend-performance-pass-2026-02-23.md` — Frontend performance pass.
- `docs/performance/database-tuning-2026-02-23.md` — Database performance tuning notes.

## Historical Incident Files
- `docs/incidents/archive/runbook.md`
- `docs/incidents/archive/oncall-checklist.md`
- `docs/incidents/archive/failure-injection-drills.md`
