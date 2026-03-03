# Tenant Admin Performance Guide

## Goals
Reduce perceived latency in tenant admin views (logs, students, items, notifications).

## Common Bottlenecks
- Over-fetching on initial page load.
- Sequential requests that can run in parallel.
- Slow profile/session checks blocking route readiness.
- Repeated background polling while tab is hidden.

## Frontend Optimizations
- Lazy load heavy admin modules.
- Cache stable reference data with stale-while-revalidate.
- Debounce searches and filters.
- Limit table payload size and paginate server-side.
- Avoid duplicate calls during route changes.

## Backend/Query Optimizations
- Ensure indexes on common filter/sort columns.
- Use selective columns instead of `select *`.
- Add limits and deterministic ordering.
- Profile slow query plans and tune indexes.

## Observability
Track:
- route navigation timing
- API latency p50/p95
- timeout count
- retry count

## Validation Workflow
1. Capture baseline timings before changes.
2. Apply one optimization at a time.
3. Re-measure p50/p95 and user-perceived load time.
4. Keep only changes with measurable improvement.
