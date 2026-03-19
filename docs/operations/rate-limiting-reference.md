# Rate Limiting Reference

## Overview

ItemTraxx uses a two-tier rate limiting system:

1. **Client-side ephemeral buffer** — prevent rapid bursts from UI
2. **Server-side RPC-enforced limits** — enforce hard limits per role/scope

This document explains parameters, error codes, reset behavior, and integration patterns.

---

## Server-Side Rate Limiting

### RPC Function: `consume_rate_limit()`

**Location**: `supabase/sql/`

**Signature**:
```sql
consume_rate_limit(
  p_scope TEXT,           -- 'tenant' | 'admin' | 'super' | 'checkout'
  p_limit INTEGER,        -- max requests allowed in window
  p_window_seconds INTEGER -- time window (e.g., 60)
) RETURNS RECORD (
  success BOOLEAN,        -- true if under limit, false if exceeded
  current_count INTEGER,  -- current request count in window
  reset_in_seconds FLOAT, -- seconds until counter resets
  timestamp BIGINT        -- server timestamp (ms)
);
```

### Scopes & Default Limits

| Scope | Purpose | Default Limit | Window | Per | Notes |
|-------|---------|---------------|--------|-----|-------|
| `tenant` | Student lookup, checkout operations | 30 | 60s | User | Light browsing, heavy checkout |
| `admin` | Admin list/filter operations | 15 | 60s | Admin User | Fewer admin ops; more expensive queries |
| `super` | Super admin queries & diagnostics | 60 | 60s | Super Admin | Broader access; higher limit |
| `checkout` | Checkout/return queue processing | 50 | 60s | Tenant | Background job; higher tolerance |

### Usage

#### Option 1: Explicit Check Before Operation

```typescript
// Location: src/services/rateLimitService.ts (frontend)

async function checkAndConsumeLimit(scope: string, limit: number, windowSec: number) {
  const result = await supabaseClient.rpc("consume_rate_limit", {
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSec
  });

  if (!result.success) {
    throw new Error(`Rate limit exceeded for scope "${scope}". Reset in ${result.reset_in_seconds}s`);
  }

  return result;
}

// Before admin operation
await checkAndConsumeLimit("admin", 15, 60);
await invokeEdgeFunction("admin-ops", {...});
```

#### Option 2: Silent Failure (Cache Results)

```typescript
// Option 2A: If over limit, serve cached response instead of blocking

let result;
try {
  await checkAndConsumeLimit("admin", 15, 60);
  result = await invokeEdgeFunction("admin-ops", {...}); // Fresh data
  cache.set(key, result); // Update cache
} catch (error) {
  if (error.message.includes("Rate limit exceeded")) {
    result = cache.get(key); // Serve stale data
    if (result) return result;
  }
  throw error; // No cache; must fail
}
```

**When to use**: Dashboard refreshes, list operations (where stale data < 10s is acceptable)

#### Option 3: Backend-Side Check (Edge Function)

Some edge functions check limits themselves:

```typescript
// Inside edge function (Deno)
const { data: limitCheck } = await supabaseClient.rpc("consume_rate_limit", {
  p_scope: "admin",
  p_limit: 15,
  p_window_seconds: 60
});

if (!limitCheck.success) {
  return new Response(
    JSON.stringify({ error: "Rate limit exceeded", resetIn: limitCheck.reset_in_seconds }),
    { status: 429, headers: { "Retry-After": limitCheck.reset_in_seconds.toString() } }
  );
}
```

**When to use**: Mutations (write operations) that should hard-block if over limit

---

## Error Codes & Responses

### Client-Side (Frontend Service)

**Error: Rate Limit Exceeded**
```typescript
{
  error: true,
  code: "RATE_LIMIT_EXCEEDED",
  message: "You are making requests too quickly. Please try again in 45 seconds.",
  retryAfterSeconds: 45,
  scope: "admin",
  currentCount: 16,
  limit: 15
}
```

**Handling**:
```typescript
try {
  await checkAndConsumeLimit("admin", 15, 60);
} catch (error) {
  if (error.code === "RATE_LIMIT_EXCEEDED") {
    showNotification(`Try again in ${error.retryAfterSeconds}s`, "warning");
    disableAdminPanel(error.retryAfterSeconds * 1000);
  }
}
```

### Backend (Edge Function)

**HTTP 429 — Too Many Requests**
```json
{
  "error": "Rate limit exceeded",
  "scope": "admin",
  "limit": 15,
  "window_seconds": 60,
  "reset_in_seconds": 42.5,
  "current_count": 16
}
```

**HTTP Headers**:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
```

### Storage Backend (RPC Error)

**PostgreSQL Error** (if something breaks):
```
ERROR: rate_limit_window is invalid (function configuration error)
```

**Handling**: Log for observability; manually call support

---

## Reset Behavior

### Per-User, Per-Scope, Per-Window

- Each **user** has separate counters
- Each **scope** (`tenant`, `admin`, `super`, `checkout`) is independent
- Counter resets every **N seconds** (e.g., 60s for admin scope)

### Example Timeline

```
T=0s   User 1 makes request #1 (admin scope) → success (count: 1)
T=5s   User 1 makes request #2 (admin scope) → success (count: 2)
T=10s  User 1 makes request #15 (admin scope) → success (count: 15)
T=12s  User 1 makes request #16 (admin scope) → BLOCKED (count: 16, limit: 15)
       Error message: "Reset in 48s"
T=58s  User 1 makes request #17 (admin scope) → still blocked (count: 16, only 2s left in window)
T=60s  Window expires; counter resets to 0
T=61s  User 1 makes request #18 (admin scope) → success (count: 1, new window)
```

### User-Specific (Not Global)

```
T=0s   User A makes request #1 (admin scope) → success (count: 1)
T=0s   User B makes request #1 (admin scope) → success (count: 1)
       ↑ Independent counters; no interference
T=10s  User A makes request #15 (admin scope) → success
T=10s  User B makes request #15 (admin scope) → success (same count, same success)
T=12s  User A makes request #16 → BLOCKED (A's count: 16)
T=12s  User B makes request #16 → success (B's count: 16, but < limit? possible data race; see below)
```

**Note**: Rate limiting is per-actor (user_id), not global. Prevents one user from blocking another.

---

## Data Race Scenario & Handling

**Scenario**: Two simultaneous requests in flight at T=59.9s (near window boundary)

```
Request A checks counter at T=59.9s → count = 15, success
Request B checks counter at T=59.9s → count = 15, success
  ↓
Both increment and consume the limit in same instant
  ↓
Both succeed (correct behavior; consuming in same window)
  ↓
T=60s: window resets
  ↓
Request C arrives → count = 0 (reset), success
```

**Implementation** (at SQL layer):

```sql
-- Atomic increment + check in single transaction
BEGIN;
  UPDATE rate_limit_counters 
  SET count = count + 1 
  WHERE user_id = ${userId} AND scope = ${scope};
  
  SELECT count FROM rate_limit_counters 
  WHERE user_id = ${userId} AND scope = ${scope};
  
  -- Compare count to limit; return success/fail
COMMIT;
```

**Why it's safe**: PostgreSQL transaction isolation prevents double-counting.

---

## Client-Side Ephemeral Buffer

### Purpose

Before calling `consume_rate_limit()` RPC, client prevents UI from firing rapid repeats.

### Implementation

```typescript
// Location: src/services/rateLimitService.ts

class EphemeralRateLimiter {
  private buffer: Map<string, number> = new Map(); // key → timestamp of last call

  canProceed(key: string, minIntervalMs: number = 500): boolean {
    const lastCall = this.buffer.get(key) || 0;
    const now = Date.now();
    const elapsed = now - lastCall;

    if (elapsed < minIntervalMs) {
      return false; // Too soon; block locally
    }

    this.buffer.set(key, now);
    return true; // Proceed to server-side check
  }
}
```

### Usage

```typescript
// Prevent "Search" button from firing 100 times if clicked rapidly
const searchBuffer = new EphemeralRateLimiter();

async function onSearchClick() {
  if (!searchBuffer.canProceed("admin_search", 500)) {
    return; // Silently ignore rapid clicks
  }

  try {
    await checkAndConsumeLimit("admin", 15, 60);
    results = await invokeEdgeFunction("admin-ops", { action: "search_students", ... });
  } catch (error) {
    showError("Rate limit exceeded");
  }
}
```

### Typical Intervals

| Operation | Min Interval | Reason |
|-----------|--------------|--------|
| Search/filter | 500ms | User typically types/clicks slower |
| Form submit | 1000ms | Prevent accidental double-submit |
| Refresh button | 2000ms | Let previous request complete |
| Auto-sync (bg) | 5000ms | Batch multiple requests |

---

## Testing

### Unit Test: Rate Limit Counter

```typescript
// tests/e2e/rate-limiting.spec.ts

describe("Rate Limiting", () => {
  test("should allow requests under limit", async () => {
    const { page } = await setupTest();
    
    // 14 requests should succeed
    for (let i = 0; i < 14; i++) {
      const result = await page.evaluate(() => 
        window.__$.rpc("consume_rate_limit", {
          p_scope: "admin",
          p_limit: 15,
          p_window_seconds: 60
        })
      );
      expect(result.success).toBe(true);
    }
  });

  test("should block request at limit", async () => {
    // 15th request should fail
    const result = await page.evaluate(() => 
      window.__$.rpc("consume_rate_limit", {
        p_scope: "admin",
        p_limit: 15,
        p_window_seconds: 60
      })
    );
    expect(result.success).toBe(false);
    expect(result.reset_in_seconds).toBeGreaterThan(0);
  });
});
```

### Integration Test: Frontend Handling

```typescript
test("should show 'try again' message on rate limit", async () => {
  const { page } = await setupTest();
  await setAdminSession(page);

  // Exhaust limit
  for (let i = 0; i < 15; i++) {
    await page.click("button:has-text('List Tenants')");
  }

  // 16th click should fail
  await page.click("button:has-text('List Tenants')");
  
  // Should see error notification
  const errorMsg = await page.locator("text=try again").isVisible();
  expect(errorMsg).toBe(true);
});
```

---

## Monitoring & Observability

### Key Metrics

1. **Rate limit hits per user/scope** — How often do users hit limits?
2. **Average reset wait time** — How long do users wait?
3. **Scope distribution** — Which scopes trigger limits most?

### Observability Integration

```typescript
// Location: src/services/perfTelemetry.ts

export function recordRateLimitHit(scope: string, resetInSeconds: number) {
  perfTelemetry.push({
    event: "rate_limit_hit",
    scope,
    resetInSeconds,
    timestamp: Date.now()
  });
  
  // Export to observability provider
  if (!isDev()) {
    exportMetric("rate_limit.hit", { scope, resetInSeconds });
  }
}
```

### Alert Thresholds

- **Alert**: Same user hits limit > 10x in 1 hour → possible scraper/attack
- **Alert**: Scope with > 50% hit rate → limit too low?
- **Alert**: Reset wait > 60s for admin scope → sustained heavy load

---

## Troubleshooting

### "Rate limit errors for all users simultaneously"

**Triage:**
1. Check if limit values changed recently
2. Check if window_seconds is misconfigured (e.g., 1s instead of 60s)
3. Check if counter table corrupt or reset

**Fix:**
```sql
-- Inspect rate limit configuration
SELECT * FROM rate_limit_counters ORDER BY updated_at DESC LIMIT 10;

-- If corrupted, truncate (will reset all counters)
TRUNCATE rate_limit_counters;
```

### "One user always hits limits; others don't"

**Triage:**
1. Is that user making 10x more requests?
   - Check audit logs for that user_id
2. Is their actions legitimate (e.g., large export)?
   - Check action type
3. Is there a UI loop that's firing requests repeatedly?
   - Check browser DevTools Network tab

**Fix:**
- Optimize UI (batch requests, debounce clicks)
- Or, increase limit for that scope
- Or, add allowlist for known heavy users

### "Rate limit RPC always returns success; counter not incrementing"

**Triage:**
1. Check if rate_limit_counters table exists
2. Check if triggers are firing (PostgreSQL logs)
3. Check if policy on table blocks RPC

**Fix:**
```sql
-- Verify table structure
SELECT * FROM information_schema.columns 
WHERE table_name = 'rate_limit_counters';

-- Verify RPC executable
SELECT * FROM pg_proc WHERE proname = 'consume_rate_limit';

-- Test RPC directly
SELECT consume_rate_limit('admin', 15, 60);
```

---

## Related Documentation
- [Session Refresh & Auth Flow](session-refresh-and-auth-flow.md) — coordinate rate limits with token refresh
- [Caching Strategy](../caching-strategy.md) — combine caching + rate limiting for efficiency
- [Admin Verification Edge Cases](../security/rbac-threat-model-2026-02-23.md#admin-verification-ttl-edge-cases) — admin scope limits
