# Runbook: Tenant Disabled — Incident Response

## Symptoms

Users from a specific tenant report:
- "I can't log in"
- "I can access the page but all actions fail"
- "Admin operations return mysterious errors"
- "Checkout fails silently"
- "I got signed out unexpectedly"

---

## Root Cause: What Happens When Tenant Is Disabled

When a tenant's status is changed to `suspended`, `archived`, or `deleted_at` is set:

```sql
-- Tenant record marked as disabled
UPDATE tenants 
SET disabled = true, deleted_at = now() 
WHERE id = ${tenant_id};
```

The cascade is:

1. **RLS Policies Block All Data Access**
   - All queries include RLS filter: `tenants.disabled = false`
   - User's role lookups fail (undefined role)
   - Student lists return empty
   - Gear lists return empty

2. **Edge Functions Detect Tenant Status**
   - Most functions check: `SELECT disabled FROM tenants WHERE id = ${tenant_id}`
   - If disabled = true: return `403 { error: "Tenant is disabled" }`
   - Some functions still accept read calls; write calls blocked

3. **Frontend Auto-Logout**
   - [edgeFunctionClient.ts](src/services/edgeFunctionClient.ts) detects `isTenantDisabledError()`
   - Clears `authState.session` and `authState.user`
   - Navigates to `/login` with optional message: "Tenant suspended"

4. **Checkout Queue Offline Sync Fails**
   - Buffered checkout items in localStorage cannot sync
   - Backend rejects with 403
   - Items remain in queue indefinitely (until tenant re-enabled)

---

## Triage Checklist

### Step 1: Confirm Tenant Is Actually Disabled

```bash
# SSH to Supabase or use web console
supabase --project-id ${PROJECT_ID} db shell

-- Check tenant status
SELECT id, name, disabled, deleted_at FROM tenants WHERE id = ${TENANT_ID};

-- If disabled = true or deleted_at != null → CONFIRMED
```

### Step 2: Identify How It Got Disabled

- **Intentional**: Admin action (in Vercel logs or audit trail)?
- **Accidental**: Data migration bug? Bad script?
- **Security**: Compromised credentials? Detected abuse?

```bash
# Check audit logs in Supabase
SELECT * FROM admin_audit_logs 
WHERE tenant_id = ${TENANT_ID} 
AND action LIKE '%disable%' OR action LIKE '%delete%'
ORDER BY created_at DESC 
LIMIT 10;
```

### Step 3: Assess User Impact

- **Single user affected**: Likely profile/role issue; may not be tenant-wide disable
- **All users from tenant**: Confirm tenant is disabled; proceed to recovery
- **Multiple tenants affected**: Search for systemic issue (bad migration, edge function deploy, etc.)

### Step 4: Check for Related Incidents

- **Deployment within last hour?** Check deploy logs and edge function versions
- **Data migration job run?** Check async job logs for errors
- **Kill-switch enabled?** Check `ITX_ITEMTRAXX_KILLSWITCH_ENABLED` env var

---

## Recovery Steps

### Option A: Quick Re-Enable (If Accidental)

```sql
-- Re-enable tenant immediately
UPDATE tenants 
SET disabled = false, deleted_at = null 
WHERE id = ${TENANT_ID};

-- Verify
SELECT id, name, disabled, deleted_at FROM tenants WHERE id = ${TENANT_ID};
```

**Expected behavior after re-enable:**
- Existing user sessions still valid
- New logins work
- Checkout queue syncs automatically
- RLS policies allow data access again

**Timeline:** Less than 30 seconds; no re-deploy needed

### Option B: Staged Re-Enable with Validation (If Unknown Cause)

1. **Re-enable in TEST environment first**
   ```sql
   -- In Supabase branch/staging
   UPDATE tenants SET disabled = false WHERE id = ${TENANT_ID};
   
   -- Run smoke tests
   npm run test:e2e
   ```

2. **If all green, re-enable in PROD**
   ```sql
   -- In production Supabase
   UPDATE tenants SET disabled = false WHERE id = ${TENANT_ID};
   ```

3. **Verify end-to-end**
   - One user logs in from that tenant
   - Can access admin panel (if admin)
   - Can complete checkout (if tenant_user)
   - No cascading errors in console

### Option C: Deliberate Deactivation (Planned Maintenance)

If disabling tenant intentionally (e.g., cleanup, contract ended):

1. **Notify users** (24–48 hours advance)
2. **Export/archive data** (if needed)
   ```bash
   # Use super-admin export or manual SQL dump
   pg_dump -h ${SUPABASE_HOST} -U postgres ${DB} > tenant_${TENANT_ID}_backup.sql
   ```
3. **Disable tenant**
4. **Set TTL** on deletion (e.g., 90 days before hard delete per data governance policy)
5. **Document decision** in incident tracking

---

## What Users Experience (And How to Communicate)

### Experience 1: User Already Logged In

```
User navigating admin dashboard
  ↓
Clicks "List Tenants"
  ↓
Edge function called; returns 403 { error: "Tenant is disabled" }
  ↓
Frontend detects isTenantDisabledError()
  ↓
Session cleared; user navigated to login page
  ↓
User sees: "Your account is temporarily unavailable. Please contact support."
```

**User message**: "I got signed out and there's a brief message but it disappeared"

### Experience 2: User Not Yet Logged In

```
User visits app.itemtraxx.com/login
  ↓
Enters credentials → Supabase login succeeds (auth independent of tenant)
  ↓
Frontend loads user profile via edge function
  ↓
Edge function calls admin-ops (get_user_profile)
  ↓
Returns 403 (tenant disabled)
  ↓
Frontend clears session, redirects to login
  ↓
User sees: "Invalid credentials" or generic error
```

**User message**: "Login fails immediately after I enter my password"

### Experience 3: Offline Queue Impact

```
User in offline mode; has buffered checkout items
  ↓
Connection restored
  ↓
Frontend attempts sync via checkoutReturn edge function
  ↓
Returns 403 (tenant disabled)
  ↓
Items stuck in localStorage; no retry or error notification
  ↓
User opens DevTools to see why items aren't syncing
```

**User message**: "My offline items won't sync; I don't understand why"

**Recommended user-facing messaging:**
- "Your tenant account has been temporarily suspended. Please contact support if you believe this is an error."
- Provide support email/link on error page

---

## Automation & Monitoring

### 1. Alert on Tenant Disable

Add to monitoring stack (e.g., Sentry, PagerDuty):

```sql
-- Trigger alert if any tenant disabled outside of planned maintenance window
SELECT id, name, disabled, deleted_at, updated_at 
FROM tenants 
WHERE disabled = true 
AND deleted_at > now() - interval '5 minutes'
AND updated_at > now() - interval '5 minutes';
```

### 2. Prevent Accidental Disables

Add confirmation step in admin UI:
```typescript
// Proposed feature in super-admin tenant management
async function disableTenant(tenantId) {
  const confirmed = await showConfirmationModal(
    "Disabling this tenant will sign out all users and block all operations. Continue?"
  );
  if (!confirmed) return;
  
  // Only then call backend
  await invokeEdgeFunction("super-tenant-mutate", {
    action: "disable_tenant",
    payload: { tenantId }
  });
}
```

### 3. Clear Offline Queue on Tenant Disable

Proposed enhancement to edgeFunctionClient:

```typescript
// Location: src/services/edgeFunctionClient.ts
function isTenantDisabledError(error): boolean {
  return error.status === 403 && error.message.includes("Tenant is disabled");
}

if (isTenantDisabledError(error)) {
  // Clear offline queue to prevent sync attempts
  checkoutService.debugClearOfflineBuffer();
  
  authState.session = null;
  // Navigate to error page with explanation
}
```

### 4. Observability: Track Disable Events

Log all tenant disable/enable operations:

```sql
-- Insert audit log when tenant disabled
INSERT INTO admin_audit_logs (
  actor_id, 
  action, 
  tenant_id, 
  metadata
) 
VALUES (
  ${actorId}, 
  'tenant_disabled', 
  ${tenantId}, 
  jsonb_build_object(
    'reason', 'suspended',
    'auto_or_manual', 'manual',
    'timestamp', now()
  )
);
```

---

## Debug Commands

### 1. Check Tenant Status

```bash
# View tenant record
curl -X POST https://${SUPABASE_URL}/rest/v1/rpc/get_tenant_status \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"p_tenant_id": "'${TENANT_ID}'"}' | jq .

# Expected response (disabled):
# { "disabled": true, "deleted_at": "2026-03-18T14:00:00Z" }
```

### 2. Check RLS Policies Block Access

```bash
# Simulate user query (from tenant)
curl -X GET https://${SUPABASE_URL}/rest/v1/students \
  -H "Authorization: Bearer ${USER_JWT}" | jq .

# Expected response (if tenant disabled):
# []  (empty; RLS filters out all rows)
```

### 3. Check Edge Function Response

```bash
# Call admin-ops directly
curl -X POST https://${EDGE_PROXY_URL}/admin-ops \
  -H "Authorization: Bearer ${USER_JWT}" \
  -d '{"action": "list_admin_tenants"}' | jq .

# Expected response (if tenant disabled):
# { "error": "Tenant is disabled", "details": {...} }
```

### 4. Verify Re-Enable

```bash
# After re-enabling, retry above commands
# Should return normal data, not empty or error
```

---

## Rollback Procedures

### If Re-Enable Causes New Errors

1. **Immediate**: Disable tenant again
   ```sql
   UPDATE tenants SET disabled = true WHERE id = ${TENANT_ID};
   ```

2. **Investigate**: Check recent deployments or data changes

3. **Fix**: Address root cause (e.g., revert edge function, migrate data)

4. **Retry**: Re-enable and retest

### If Multiple Tenants Affected

Stop and escalate:
1. **Confirm scope**: How many tenants disabled?
2. **Check for systemic cause**: (bad migration, edge function crash, etc.)
3. **Rollback** the suspected change (not individual tenant re-enables)
4. **Test** in staging first
5. **Deploy** to prod

---

## Related Documentation
- [RBAC Threat Model](security/rbac-threat-model-2026-02-23.md) — authorization checks that prevent tenant-disabled leaks
- [Session Refresh & Auth Flow](session-refresh-and-auth-flow.md) — how frontend detects tenant disabled and clears session
- [Offline Queue Design](offline-queue-design.md) — queue behavior during network/auth failures
- [Incident Response](../incident-response.md) — general incident escalation and communication
