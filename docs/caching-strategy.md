# Caching Strategy & TTL Registry

## Overview

ItemTraxx frontend uses an in-memory caching layer (`withCachedAdminOp()`) to deduplicate concurrent API requests and reduce load on edge functions. This document centralizes all cache keys, TTLs, and invalidation patterns.

## Cache Pattern

All admin and super-admin endpoints use the same caching wrapper:

```typescript
// From adminOpsService.ts
const data = await withCachedAdminOp(cacheKey, ttlMs, async () => {
  return await invokeEdgeFunction<ResponseType>("function-name", {...});
});
```

### How It Works
1. **Key lookup**: Check in-memory cache by key
2. **Hit**: Return cached data if `now - createdAt < ttlMs`
3. **Miss or stale**: Call loader function, update cache, return data
4. **Concurrent dedup**: Multiple callers for same key while miss in-flight share single loader Promise

### Implementation
- **Location**: [src/services/adminOpsService.ts](src/services/adminOpsService.ts) lines 82–120
- **Structure**: Map<cacheKey, { data, createdAt, TTL }>
- **Thread-safe**: Via Promise dedup; concurrent requests for expired key get fresh result pipelined

---

## Cache Key Registry

### Tenant Admin Caching

| Key | Function | TTL | Purpose | Invalidation |
|-----|----------|-----|---------|--------------|
| `tenant_options_${tenantId}` | `admin-ops` (action: `get_tenant_options`) | **30s** | Feature flags, config | Manual: create/update tenant → clear key |
| `tenant_list` | `admin-ops` (action: `list_admin_tenants`) | **60s** | Tenant roster for admin | Auto: 60s decay; Manual: add/remove tenant |
| `touch_session_${tenantId}` | `admin-ops` (action: `touch_admin_session`) | **20s** | Keep admin verified TTL at 15min | Auto: 20s renew (prevents rapid re-auth) |
| `validate_session_${tenantId}` | `admin-ops` (action: `validate_admin_session`) | **5s** | Check if admin still verified | Auto: 5s decay; Manual: on step-up modal close |

### District Admin Caching

| Key | Function | TTL | Purpose | Invalidation |
|-----|----------|-----|---------|--------------|
| `district_dashboard_${districtId}` | `district-dashboard` | **45s** | Full dashboard (tenants, stats) | Manual: refresh button; Auto: 45s decay |
| `district_tenants_${districtId}` | `district-dashboard` | **30s** | Tenant list subset | Auto: 30s decay |

### Super Admin Caching

| Key | Function | TTL | Purpose | Invalidation |
|-----|----------|-----|---------|--------------|
| `super_dashboard_data` | `super-dashboard` | **60s** | Org-wide metrics, health | Manual: refresh; Auto: 60s decay |
| `super_tenant_list` | `super-dashboard` | **45s** | All tenant roster | Auto: 45s decay; Manual: add/remove tenant |
| `super_logs_query_${query_id}` | `super-logs-query` | **120s** (2min) | Expensive query result set | Manual: new query → new key |

### System/Public Caching

| Key | Function | TTL | Purpose | Invalidation |
|-----|----------|-----|---------|--------------|
| `system_status` | `system-status` | **5s** | Platform health, version | Auto: 5s decay; Manual: killswitch change |
| `perf_metrics_snapshot` | Local (perfTelemetry.ts) | **Session** | Browser metrics (FCP, TTFB) | Cleared on page reload |

---

## Invalidation Patterns

### Pattern A: Time-Based Decay (Most Common)
- Cache expires after TTL
- No explicit invalidation needed
- **Risk**: Stale data visible until TTL elapses
- **Mitigation**: Keep TTL short (5–60s depending on impact)
- **Examples**: `tenant_options` (30s), `super_logs_query` (120s)

### Pattern B: Manual Invalidation
- Called after mutation (create/update/delete)
- **How**: Call the loader function directly; pass new data to cache manager
- **Examples**: After tenant update → `withCachedAdminOp(key, ttl, loaderFn)` called again with new key
- **Risk**: Forgot to invalidate → stale UI until timeout
- **Mitigation**: Search for cache key in mutation handlers; add invalidation comment

### Pattern C: Hybrid (Time + Manual)
- Time-based decay + invalidation on known mutations
- **Preferred pattern** for critical data
- **Example**: `tenant_options_${tenantId}` → invalidate on tenant update (manual), otherwise auto-expire (30s)

### Pattern D: Request De-duplication (Concurrent Requests)
- Multiple requests for same key within TTL share single loader call
- No invalidation needed; handled by Promise queue
- **Example**: Dashboard refresh + admin click "reload tenants" simultaneously → single backend call

---

## Best Practices

### 1. Choose TTL Based on Update Frequency
- **Frequently updated** (session state): 5–20s
- **Semi-stable** (tenant config, feature flags): 30–60s
- **Stable** (org metadata, logs): 60–120s
- **Never cache**: One-time operations (checkout, mutations)

### 2. Invalidation Checklist
Before adding cache, ask:
- [ ] Is this data read-heavy? (cache only if yes)
- [ ] What mutations invalidate it?
- [ ] Should invalidation be manual, time-based, or hybrid?
- [ ] What's the worst case if we serve stale data for TTL seconds?

### 3. Key Naming Convention
```
${domainPrefix}_${operation}_${scopeParam}
// Examples:
admin_options_${tenantId}
district_dashboard_${districtId}
super_logs_${queryId}
global_system_status
```

### 4. Concurrent Request Safety
- Do NOT hold mutable state after cache hit
- Always treat cached data as immutable
- If mutation needed, invalidate key and reload

### 5. Development Debugging
```typescript
// Check cache contents at runtime
console.info("Cache state:", adminOpsService.debugGetCacheSnapshot());

// Manually clear cache (dev only, not for production)
adminOpsService.debugClearCache();
```

---

## Cache Lifecycle: Admin Step-Up Example

```
User clicks "admin panel" → route guard checks adminVerifiedAt TTL
  ↓
(adminVerifiedAt stale? > 15 min old)
  ↓
Step-up modal shown → user re-enters password
  ↓
admin-ops (action: step_up_admin) called
  ↓
Backend validates password, returns new adminVerifiedAt timestamp
  ↓
Frontend updates authState.adminVerifiedAt
  ↓
Cache key "touch_session_${tenantId}" created with 20s TTL
  ↓
Each subsequent admin action touches session (refresh adminVerifiedAt server-side)
  ↓
After 15 minutes of inactivity, adminVerifiedAt expires
  ↓
Next admin action triggers step-up modal again
```

**Cache hit inside 20s window**: `touch_session_${tenantId}` returns cached response, no backend call.

---

## Monitoring & Observability

### Current State
- Cache hits/misses tracked via console.info in DEV mode only
- No metrics exported to observability stack
- No alerts on high miss rate

### Recommended Additions
1. Add `cache:hit` / `cache:miss` counters to `perfTelemetry.ts`
2. Export to observability dashboard
3. Alert if miss rate > 50% for key (suggests TTL too short)

### Debug Output
```javascript
// Add to adminOpsService.debugCacheStats()
{
  totalRequests: 342,
  hits: 289,
  misses: 53,
  hitRate: 0.845,
  keyStats: {
    "tenant_options_${id}": { hits: 120, misses: 5, avgHitWait: "2ms" },
    "touch_session_${id}": { hits: 150, misses: 3, avgHitWait: "5ms" }
  }
}
```

---

## Related Documentation
- [Session Refresh & Auth Flow](runbooks/session-refresh-and-auth-flow.md) — how cache coordinates with token refresh
- [Admin Verification Edge Cases](security/rbac-threat-model-2026-02-23.md#admin-verification-ttl-edge-cases) — 15-min TTL validation
- [Performance Telemetry Ingestion](performance/telemetry-ingestion.md) — how to monitor cache performance
