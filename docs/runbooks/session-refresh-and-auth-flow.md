# Runbook: Session Refresh & Auth Flow

## Overview

Session management in ItemTraxx involves coordinating Supabase JWT tokens, frontend auth state, admin verification TTLs, and fallback mechanisms. This runbook explains the complete flow and common failure modes.

## Architecture

```
Browser (SPA)
  ├─ User Auth State (authState.ts)
  │  ├─ user: { id, email, role }
  │  ├─ session: { accessToken, refreshToken, expiresAt }
  │  ├─ adminVerifiedAt: timestamp (15-min TTL)
  │  └─ superVerifiedAt: timestamp (15-min TTL)
  │
  ├─ Access Token Manager (sessionAccessToken.ts)
  │  ├─ getFreshAccessToken() → Promise<token>
  │  │  ├─ If local token valid and expires > 5min away: return cached
  │  │  ├─ If local token stale: Supabase.auth.refreshSession()
  │  │  ├─ If refresh fails: clear auth state, throw "Unauthorized"
  │  │  └─ Cache fresh token for 5min to avoid thrashing
  │  │
  │  └─ Auto-retry on 401: edgeFunctionClient.ts
  │     ├─ Call edge function
  │     ├─ If 401 returned: call getFreshAccessToken(), retry once
  │     ├─ If still fails: throw "Unauthorized" → user → login page
  │
  └─ Edge Function Client (edgeFunctionClient.ts)
     ├─ invokeEdgeFunction<TResponse, TBody>(name, { method, body, accessToken })
     ├─ Sends Authorization: Bearer ${accessToken} header
     └─ 10s timeout; auto-retry on 401; fails on 403, 500, timeout
```

## Flows

### Flow 1: Happy Path — Fresh Session + Admin Step-Up

```
1. User logs in
   └─ Supabase.auth.signInWithPassword() → JWT + refresh token
   └─ authState = { user, session, adminVerifiedAt: null, superVerifiedAt: null }

2. User navigates to /admin
   └─ Route guard checks: requiresRole('tenant_admin') + requiresTenantLevelAuth()
   └─ adminVerifiedAt null or > 15min old? → Step-Up Modal
   └─ User re-enters password

3. Step-up call
   └─ invokeEdgeFunction("admin-ops", { action: "step_up_admin", payload: { password } })
   └─ Backend: hash password, validate, return { newAdminVerifiedAt: now() }
   └─ Frontend: authState.adminVerifiedAt = newAdminVerifiedAt

4. Admin action (e.g., list tenants)
   └─ accessToken = getFreshAccessToken()
   │  └─ Local token still valid? return cached
   │  └─ Else: Supabase.auth.refreshSession()
   │
   └─ invokeEdgeFunction("admin-ops", { action: "list_admin_tenants" })
   │  └─ Authorization: Bearer ${accessToken}
   │
   └─ With caching: check "tenant_list" cache key first
   │  └─ Hit (< 60s old)? return cached
   │  └─ Miss? call backend, store in cache, return
   │
   └─ UI updates with tenants

5. Admin verified TTL expires after 15 minutes of active use
   └─ Next admin action calls admin-ops
   └─ Step-up modal shown again
```

### Flow 2: Token Refresh on 401

```
1. User has valid Supabase session
   └─ accessToken expires in 1 minute

2. Admin clicks "list tenants"
   └─ invokeEdgeFunction("admin-ops", { action: "list_admin_tenants" })
   └─ localAccessToken sent but expired server-side

3. Edge function validates JWT, gets 401
   └─ edgeFunctionClient.ts catches error

4. Auto-retry with fresh token
   └─ getFreshAccessToken() called
   │  └─ Local token is stale (< 5min to expiry)
   │  └─ Supabase.auth.refreshSession() (uses refresh token)
   │  └─ Returns new accessToken
   │
   └─ invokeEdgeFunction("admin-ops", { action: "list_admin_tenants" }) (retry)
   │  └─ Authorization: Bearer ${newAccessToken}
   │
   └─ Success! UI updates

5. If refresh token also expired
   └─ Supabase.auth.refreshSession() fails
   └─ sessionAccessToken.ts clears authState
   └─ edgeFunctionClient throws "Unauthorized"
   └─ UI navigates to /login
```

### Flow 3: Tenant Disabled (Global Kill Switch)

```
1. User has active session and admin verified

2. Admin action called
   └─ invokeEdgeFunction("admin-ops", { action: "..." })
   └─ Backend: checks if tenant.disabled = true (soft delete)

3. If tenant disabled
   └─ Edge function returns 403 { error: "Tenant is disabled" }
   └─ edgeFunctionClient.ts detects isTenantDisabledError()

4. Frontend response
   └─ authState.session cleared
   └─ User navigated to maintenance page or login

5. RLS policies also enforce: all queries filtered by tenant_id
   └─ Backend won't leak data if disabled
   └─ Frontend clears session as defense-in-depth
```

---

## Implementation Details

### sessionAccessToken.ts — Token Cache & Refresh

```typescript
// Location: src/services/sessionAccessToken.ts

export async function getFreshAccessToken(): Promise<string> {
  // 1. Check if local token valid for next 5 minutes
  if (isLocalTokenValidFor5Minutes()) {
    return cachedAccessToken;
  }

  // 2. Local token stale; refresh with Supabase
  const { data, error } = await supabaseClient.auth.refreshSession();
  
  if (error) {
    // 3. Refresh failed; clear auth state and throw
    authState.session = null;
    authState.user = null;
    throw new Error("Unauthorized: Failed to refresh session");
  }

  // 4. Cache new token, return
  cachedAccessToken = data.session.access_token;
  return cachedAccessToken;
}
```

**Why 5-minute buffer?**
- Access tokens often have 1-hour TTL
- Checking at 5-min-to-expiry gives safety margin
- Avoids edge case of token expiring mid-request

### edgeFunctionClient.ts — 401 Auto-Retry

```typescript
// Location: src/services/edgeFunctionClient.ts

export async function invokeEdgeFunction<TResponse, TBody>(
  functionName: string,
  { method = "POST", body, accessToken }: Options
): Promise<TResponse> {
  try {
    return await callFunction(functionName, method, body, accessToken, retryCount: 0);
  } catch (error) {
    if (error.status === 401 && retryCount === 0) {
      // Token expired; get fresh one and retry once
      const freshToken = await getFreshAccessToken();
      return await callFunction(functionName, method, body, freshToken, retryCount: 1);
    }
    throw error; // All other errors propagate (403, 500, timeout, etc.)
  }
}
```

**Why only one retry?**
- If first call had valid token and failed with 401, token is stale
- One refresh should fix it
- Second retry would mean refresh also failed (session truly expired)

### authState.ts — Admin Verification TTL

```typescript
// Location: src/store/authState.ts

export const authState = reactive({
  user: null,
  session: null,
  adminVerifiedAt: null,      // Last admin step-up timestamp
  superVerifiedAt: null,      // Last super admin step-up timestamp
  adminVerifyRequired: false,  // Flag to show step-up modal
});

export function isAdminVerified(tenantId: string): boolean {
  if (!authState.adminVerifiedAt) return false;
  const ttlMs = 15 * 60 * 1000; // 15 minutes
  const elapsed = Date.now() - authState.adminVerifiedAt;
  return elapsed < ttlMs;
}
```

**Why separate from session token?**
- Session token: ~1-hour machine TTL (Supabase)
- Admin verification: ~15-min human interaction TTL (security checkpoint)
- Two separate concerns; separate expiry logic

---

## Debugging

### Symptom: "User logged out randomly"
**Triage:**
1. Check browser DevTools → Application → localStorage
   - `sb-*-auth` (Supabase session) present?
   - Is `access_token` field populated?
2. Check console for errors
   - "Unauthorized: Failed to refresh session"?
   - "Invalid JWT" from edge function?
3. Check Supabase auth logs
   - Refresh token revoked?
   - Session explicitly ended?

**Common fixes:**
- Clear localStorage `sb-*-auth`; re-login
- Check `VITE_SUPABASE_URL` matches backend URL
- Verify Supabase JWT secret matches edge function config

### Symptom: "Admin step-up modal appears on every action"
**Triage:**
1. Check if `adminVerifiedAt` is being updated after step-up
   - Console: `console.log(authState.adminVerifiedAt)`
   - Should be `Date.now()` after step-up; should NOT change for 15min
2. Check `admin-ops` (action: `step_up_admin`) response
   - Does backend return `newAdminVerifiedAt`?
   - Is frontend storing it?
3. Check if something is clearing `adminVerifiedAt` unintentionally
   - Search for `authState.adminVerifiedAt = null` in codebase
   - Check if page reload clears it (should use localStorage for persistence)

**Common fixes:**
- Add `adminVerifiedAt` to localStorage persistence (currently lost on reload)
- Ensure step-up response includes timestamp
- Extend TTL if 15min is too short for typical admin workflows

### Symptom: "Edge function returns 403 Unauthorized (but not 401)"
**Triage:**
1. Is the user authenticated?
   - Check console: `console.log(authState.user)`
2. Does JWT validate?
   - Check edge function logs for JWT validation error
   - Verify `verify_jwt: true` in function config
3. Is the user's role allowed?
   - Check RLS policy in `supabase/sql/`
   - Verify `current_user_role()` matches expected role
4. Is the tenant active?
   - Check tenant.deleted_at is null
   - Check tenant.disabled is false (or null)

**Common fixes:**
- 403 means auth succeeded but authorization failed → check RLS and role
- 401 means JWT invalid/expired → triggers auto-retry
- Regenerate access token via login flow

### Symptom: "Cache not invalidating after update"
**Triage:**
1. Check what cache key was used for the read
2. After mutation (update), was the same key cleared?
3. Or, did mutation use a different key?

**Example:**
```typescript
// Read: "tenant_options_123"
const opts = await withCachedAdminOp("tenant_options_123", 30000, loaderFn);

// Update: forgot to invalidate?
await invokeEdgeFunction("admin-ops", { action: "update_tenant_options", ... });

// Next read: still returns old options from cache!
const opts2 = await withCachedAdminOp("tenant_options_123", 30000, loaderFn);
// opts2 === opts (stale!)
```

**Fix:**
- After mutation, call cache invalidation or use a new cache key
- Or, wait for TTL to expire (30s in this example)

---

## Best Practices

### 1. Always Use getFreshAccessToken()
```typescript
// ❌ Wrong: stale token
const token = authState.session.accessToken;
await invokeEdgeFunction("admin-ops", { accessToken: token });

// ✅ Right: auto-refreshes if needed
const token = await getFreshAccessToken();
await invokeEdgeFunction("admin-ops", { accessToken: token });
```

### 2. Admin Verification for Sensitive Operations
```typescript
// ✅ Correct: check both session AND admin verification
if (!authState.user) { /* not logged in */ }
if (!isAdminVerified()) { /* show step-up modal */ }
// Now safe to call privileged operation
```

### 3. Clear Session on Logout
```typescript
// ✅ Correct: clear all auth state
authState.user = null;
authState.session = null;
authState.adminVerifiedAt = null;
authState.superVerifiedAt = null;
// Navigate to login
```

### 4. Coordinate Cache + Token Refresh
If a cache entry depends on auth state:
- Invalidate cache when session changes
- Or, use short TTL (5–20s) to naturally expire with session

---

## Related Documentation
- [Caching Strategy & TTL Registry](caching-strategy.md) — how cache coordinates with token refresh
- [RBAC Threat Model](security/rbac-threat-model-2026-02-23.md) — admin verification edge cases
- [Tenant Disabled Incident](runbooks/tenant-disabled-incident.md) — handling suspended/archived tenants
