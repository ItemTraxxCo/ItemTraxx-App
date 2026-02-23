# Data Governance Lifecycle

## Objectives
- Keep tenant data scoped and auditable.
- Retain soft-deleted records long enough for operational recovery.
- Prune stale deleted data and old audit rows under explicit policy.

## New SQL Assets
- `/supabase/sql/data_governance.sql`
  - `data_retention_policies` table
  - `run_data_retention()` function

## Recommended Operations
1. Apply SQL migration.
2. Keep retention policies disabled by default.
3. Enable in staging and validate:
   - soft-deleted students/gear purge behavior
   - audit log retention windows
4. Schedule retention with Supabase cron (service role only).

## Audit Export Workflow
- Tenant admin exports:
  - students, items, logs CSV/PDF from admin pages.
- Super admin exports:
  - global items/students/logs CSV/PDF.
- Store exported files outside app DB under org retention policy.

## Guardrails
- Never hard-delete active rows.
- Keep role/tenant-scoped audit logs accessible by policy.
- Document retention windows in customer-facing legal/policy docs if changed.
