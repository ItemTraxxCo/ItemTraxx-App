# Database Performance Tuning (2026-02-23)

## What was added
- New SQL baseline for index coverage and planner refresh:
  - `/supabase/sql/performance_tuning.sql`

## Focus areas
- Tenant-scoped list queries (students, gear, logs)
- Frequent auth/profile lookups
- Super-admin global list/search pages
- Trigram-backed `ilike` search for large tables

## Query Plan Review Checklist
1. Run `EXPLAIN (ANALYZE, BUFFERS)` on slow queries.
2. Confirm index scans on tenant-scoped predicates.
3. Confirm no repeated sequential scans on `gear`, `students`, `gear_logs`.
4. Validate sort nodes use indexed ordering where expected.
5. Re-run `ANALYZE` after large imports/archivals.

## Rollout Notes
- Apply in staging first.
- Re-check top 5 slowest queries after index build.
- If write latency regresses, remove unused trigram indexes first.
