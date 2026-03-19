# RBAC / Security Threat Model Notes (2026-02-23)

## Scope
- Frontend route/role guards in `/src/router/index.ts` and auth state handling.
- Edge-function authorization patterns under `/supabase/functions/*`.
- Tenant/super-admin mutation paths and cross-tenant data access controls.
- RLS posture for tenant and super-admin operational tables.

## Trust Boundaries
- Browser clients are untrusted; all role/tenant enforcement must happen server-side.
- Cloudflare worker proxy forwards auth headers but is not an authorization layer.
- Supabase edge functions are the authorization decision points for write APIs.
- Supabase RLS is the enforcement boundary for direct client table queries.

## Key Risks Identified
1. Dynamic PostgREST `.or(...)` filter strings used unsanitized user input in super and student flows.
2. `admin-ops` did not consistently enforce tenant-admin active status and tenant suspension for write actions.
3. RLS hardening not codified as an explicit baseline script for core tenant/super tables.
4. 404 diagnostics displayed tenant/user metadata in production responses.

## Remediations Applied
1. Removed unsanitized dynamic `.or(...)` filter usage from:
- `/supabase/functions/super-gear-mutate/index.ts`
- `/supabase/functions/super-student-mutate/index.ts`
- `/supabase/functions/super-tenant-mutate/index.ts`
- `/supabase/functions/admin-student-mutate/index.ts`

2. Hardened `admin-ops` auth consistency:
- Added `profiles.is_active` check for tenant admin callers.
- Added tenant suspension checks for tenant write actions (`update_tenant_settings`, `bulk_import_gear`).
- Standardized error path to preserve CORS/json response shape.

3. Added explicit RLS hardening SQL baseline:
- `/supabase/sql/rbac_hardening.sql`
- Includes helper identity functions and table-level policies for tenant/super-admin scope.

4. Reduced production metadata leakage on 404:
- `/src/pages/NotFound.vue` now shows role/tenant/user diagnostics only in development.

## Residual Risks / Follow-ups
- Apply `/supabase/sql/rbac_hardening.sql` in production and verify with test accounts.
- Validate no legacy DB policies conflict with the new baseline before applying in prod.
- Consider moving repeated edge auth checks into shared helper modules to reduce drift.
- Add negative authorization E2E tests (cross-tenant access, suspended tenant write attempts).

---

## Admin Verification TTL Edge Cases

### Architecture

Admin and super-admin operations require an additional authentication checkpoint separate from the main session:

- **Session TTL**: ~1 hour (Supabase JWT; machine managed)
- **Admin Verification TTL**: ~15 minutes (human re-auth checkpoint; user managed)

The 15-minute verification window ensures that:
1. A user stepping up to admin role must prove identity
2. If session idle > 15 min, user must re-verify to perform admin actions
3. Each admin action extends the verification window (by calling `touch_session`)

### Critical Invariants

#### Invariant 1: No Admin Action Without Fresh Verification

```typescript
// Correct enforcement in router guard
router.beforeEach((to, from, next) => {
  if (to.meta.requiresRole === 'tenant_admin') {
    const isVerified = isAdminVerified(tenantId);
    if (!isVerified) {
      showStepUpModal(); // Force re-auth
      return next(false);
    }
  }
  next();
});
```

**Risk**: If route guard skipped or TTL check disabled:
- Attacker with physical access to unlocked browser could perform admin operations
- Stolen session cookie could be used for sensitive operations indefinitely

**Mitigation**: Every admin action endpoint double-checks TTL server-side:
```typescript
// supabase/functions/admin-ops/index.ts
const { data: profile } = await userClient.from('profiles')
  .select('admin_verified_at')
  .eq('id', user.id)
  .single();

const ttlMs = 15 * 60 * 1000;
const verifiedAge = Date.now() - profile.admin_verified_at;

if (verifiedAge > ttlMs) {
  return new Response(
    JSON.stringify({ error: "Admin verification expired" }),
    { status: 403 }
  );
}
```

#### Invariant 2: TTL Stored in Database, Not Browser-Only

**Risk**: If TTL stored only in frontend state:
```typescript
// ❌ Wrong: frontend-only, easily bypassed
const adminVerifiedAt = authState.adminVerifiedAt;
const isVerified = Date.now() - adminVerifiedAt < 15 * 60 * 1000;
```

An attacker with console access could:
```javascript
// Attacker in console
window.__itemtraxx.authState.adminVerifiedAt = Date.now(); // Fake re-verify!
```

**Mitigation**: Backend validation is authoritative:
```sql
-- Server check is source of truth
SELECT 
  (EXTRACT(EPOCH FROM (now() - admin_verified_at)) * 1000) as age_ms
FROM profiles 
WHERE id = ${user_id};

-- Frontend stores a copy for UI (not authorization)
```

#### Invariant 3: Back Navigation Doesn't Bypass Step-Up

**Risk**: User steps up → navigates to admin panel → browser back button → back to earlier page without re-stepping-up.

**Example attack**:
```
1. User goes to /admin/students (not admin yet)
   → Step-up modal shown
2. User re-enters password
   → adminVerifiedAt = now()
   → Router allows /admin/students
3. User clicks browser back button
   → Router doesn't re-check TTL (assumes still verified)
4. User forwards
   → Still relies on TTL from step-up, not re-checking
5. 20 minutes later, user still on /admin/students
   → TTL expired, but frontend may still think verified
```

**Mitigation**: 
- Check TTL on every route transition, not just first access
- Backend double-checks TTL on every admin action
- Cache `touch_session` calls (20s TTL) to avoid excessive re-checks

#### Invariant 4: Concurrent Requests Don't Share TTL State

**Risk**: User makes 2 simultaneous admin requests near TTL boundary:
```
T=14:50  Admin request A sent (verified)
T=14:50  Admin request B sent (verified)
T=14:51  Both requests hit backend & execute (TTL still valid)
T=15:01  Both responses arrive (TTL now expired)
```

This is **correct behavior**; both should succeed (requests made within window).

**Actual risk**: If frontend caches TTL result and doesn't re-check:
```typescript
// ❌ Wrong: cache check result
let cachedIsVerified = false;
function isAdminVerified() {
  if (cachedIsVerified) return true; // Doesn't re-check!
  // ... check TTL ...
  cachedIsVerified = true;
  return true;
}
```

**Mitigation**: Check actual `adminVerifiedAt` timestamp on every call:
```typescript
// ✅ Correct: always compute from current timestamp
function isAdminVerified(tenantId: string): boolean {
  if (!authState.adminVerifiedAt) return false;
  const elapsed = Date.now() - authState.adminVerifiedAt;
  return elapsed < 15 * 60 * 1000;
}
```

### Testing Checklist

- [ ] Verify step-up modal shown for admin-unverified user
- [ ] Verify admin operation succeeds immediately after step-up
- [ ] Verify admin operation fails 15+ min after step-up
- [ ] Verify backend rejects expired verification (even if frontend says ok)
- [ ] Verify page reload doesn't clear `adminVerifiedAt` without logout
- [ ] Verify browser back button doesn't skip re-verification
- [ ] Verify concurrent requests near TTL boundary succeed/fail correctly
- [ ] Verify `touch_session` extends TTL (if called within 20s cache window)

### E2E Tests

```typescript
// tests/e2e/admin-verification-ttl.spec.ts

describe("Admin Verification TTL", () => {
  test("should show step-up modal for unverified admin", async ({ page }) => {
    await setTenantUserSession(page);
    await page.goto("/admin");
    
    const modal = await page.locator("text=Verify Your Identity");
    await expect(modal).toBeVisible();
  });
  
  test("should block admin operation after 15 minutes", async ({ page }) => {
    await setAdminSession(page);
    
    // Set adminVerifiedAt to 16 minutes ago
    await page.evaluate(() => {
      window.__itemtraxx.authState.adminVerifiedAt = Date.now() - (16 * 60 * 1000);
    });
    
    // Try admin operation
    await page.goto("/admin/students");
    
    const modal = await page.locator("text=Verify Your Identity");
    await expect(modal).toBeVisible();
  });
  
  test("should enforce backend TTL even if frontend says ok", async ({ page }) => {
    await setAdminSession(page);
    
    // Frontend thinks verified
    expect(await page.evaluate(() => 
      window.__itemtraxx.isAdminVerified()
    )).toBe(true);
    
    // But backend will reject if TTL expired
    // (Simulated by test mock returning 403)
    const result = await page.evaluate(() => 
      window.__$.invokeEdgeFunction("admin-ops", {
        action: "list_admin_tenants",
        accessToken: "..." // TTL expired token
      })
    );
    
    expect(result.error).toContain("verification expired");
  });
});
```

### Observability

Monitor for:
1. **Step-up successes**: Count of admin re-auths (should be ~1 per 15 min per user)
2. **TTL expirations**: Count of 403 "verification expired" errors
3. **Touch session calls**: Should correlate with admin actions (1:1 ratio)

```sql
-- Alert if step-up failures spike
SELECT 
  COUNT(*) as stepup_failures,
  DATE_TRUNC('minute', created_at) as minute
FROM admin_audit_logs
WHERE action = 'step_up_admin'
  AND metadata->>'success' = 'false'
  AND created_at > now() - interval '1 hour'
GROUP BY minute
HAVING COUNT(*) > 50
ORDER BY minute DESC;
```

### Related Documentation
- [Session Refresh & Auth Flow](../runbooks/session-refresh-and-auth-flow.md) — how verification TTL integrates with token refresh
- [Caching Strategy & TTL Registry](../caching-strategy.md) — `touch_session` cache coordination with 15-min TTL
- [RBAC Threat Model (Phase 2 Hardening)](security-phase2-hardening.md) — future enhancements to verification flow
