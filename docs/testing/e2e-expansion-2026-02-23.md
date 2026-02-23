# E2E Expansion (2026-02-23)

## Added Coverage
- Auth edge cases:
  - unauthenticated access to tenant-admin/super-admin routes.
- Suspended tenant behavior:
  - write path receives `403 Tenant disabled`.
- Super admin navigation flow:
  - tenants/admins/gear/students/logs route coverage.
- Export surface checks:
  - super gear/students/logs export actions visible.
- Mobile viewport smoke:
  - primary CTA and trust strip visible at 390x844.

## New Test Files
- `/tests/e2e/auth-edge-cases.spec.ts`
- `/tests/e2e/suspended-tenant.spec.ts`
- `/tests/e2e/super-flows-and-exports.spec.ts`
- `/tests/e2e/mobile-viewports.spec.ts`

## Harness Updates
- Added edge-function mocks for:
  - `super-tenant-mutate`
  - `super-admin-mutate`
  - `super-gear-mutate`
  - `super-student-mutate`
  - `super-logs-query`
  - suspended tenant `admin-ops` branch
