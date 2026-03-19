# Performance Telemetry & RUM Ingestion

## Overview

ItemTraxx captures real-user metrics (RUM) at the frontend via `perfTelemetry.ts`, but currently has **no observability ingestion or dashboarding**. This document explains:

1. **What's captured** — available metrics and their semantics
2. **Current state** — how telemetry is collected
3. **Integration steps** — how to set up ingestion to Sentry, Datadog, or similar
4. **Dashboards** — example queries and alerts

---

## What's Captured

### Location

[src/services/perfTelemetry.ts](src/services/perfTelemetry.ts)

### Metrics

| Metric | Type | Source | When Captured | Example Value |
|--------|------|--------|---------------|---------------|
| `route_navigation_ms` | number | Router navigation | After route changes | 245ms |
| `first_contentful_paint` | number | Web Performance API | When LCP happens | 1200ms |
| `time_to_first_byte` | number | Navigation Timing API | After page load | 150ms |
| `edge_function_call_ms` | number | Instrumented `invokeEdgeFunction` | After edge function completes | 420ms |
| `cache_hit` | boolean | Caching layer | On cache hit/miss | true |
| `cache_hit_latency_ms` | number | Cache lookup time | Cache hit occurs | 2ms |
| `error_type` | string | Error handler | On caught error | "TENANT_DISABLED" |
| `error_count` | number | Aggregated | Per session | 3 |

### Data Structure

```typescript
// Location: src/services/perfTelemetry.ts

interface PerformanceMetric {
  event: string;            // e.g., "route_navigation"
  timestamp: number;        // Date.now() in milliseconds
  duration?: number;        // For timed events
  value?: number;           // For counters
  label?: string;           // e.g., route path
  cached?: boolean;         // For data access
  errorType?: string;       // For error events
  metadata?: Record<string, any>; // Custom fields
}
```

### Aggregation

`perfTelemetry.ts` maintains a **50-entry sliding buffer**:

```typescript
const perfBuffer: PerformanceMetric[] = [];
const MAX_BUFFER_SIZE = 50;

export function recordMetric(metric: PerformanceMetric) {
  perfBuffer.push(metric);
  if (perfBuffer.length > MAX_BUFFER_SIZE) {
    perfBuffer.shift(); // FIFO; discard oldest
  }
}

export function getPerfMetricsSnapshot(): PerformanceMetric[] {
  return [...perfBuffer]; // Copy to prevent external mutation
}
```

### Current Observability

**Development mode** (logged to console):
```javascript
console.info("[PERF]", metric);
// Output: [PERF] { event: "edge_function_call_ms", duration: 420, label: "admin-ops" }
```

**Production mode**: No ingestion; metrics discarded.

---

## Example Usage (Frontend Instrumentation)

### Edge Function Call Timing

```typescript
// Location: src/services/edgeFunctionClient.ts

async function callFunction(name, ...args) {
  const startTime = performance.now();
  
  try {
    const result = await fetch(`${EDGE_PROXY_URL}/${name}`, {...});
    const duration = performance.now() - startTime;
    
    recordMetric({
      event: "edge_function_call_ms",
      duration,
      label: name,
      timestamp: Date.now()
    });
    
    return result;
  } catch (error) {
    recordMetric({
      event: "error",
      errorType: error.code,
      label: name,
      timestamp: Date.now()
    });
    throw error;
  }
}
```

### Cache Performance

```typescript
// Location: src/services/adminOpsService.ts

async function withCachedAdminOp(key, ttlMs, loaderFn) {
  const startTime = performance.now();
  
  const cached = cache.get(key);
  if (cached && !isExpired(cached)) {
    const hitLatency = performance.now() - startTime;
    recordMetric({
      event: "cache_hit",
      cached: true,
      duration: hitLatency,
      label: key,
      timestamp: Date.now()
    });
    return cached.data;
  }
  
  // Cache miss; load from backend
  const data = await loaderFn();
  cache.set(key, { data, createdAt: Date.now() });
  
  recordMetric({
    event: "cache_hit",
    cached: false,
    label: key,
    timestamp: Date.now()
  });
  
  return data;
}
```

### Route Navigation Timing

```typescript
// Location: src/router/index.ts

router.beforeEach((to, from, next) => {
  const startTime = performance.now();
  
  // ... guard checks ...
  
  next();
});

router.afterEach((to) => {
  const duration = performance.now() - startTime;
  recordMetric({
    event: "route_navigation_ms",
    duration,
    label: to.path,
    timestamp: Date.now()
  });
});
```

---

## Integration Steps

### Step 1: Choose Observability Provider

**Recommended options:**
- **Sentry** — error tracking + RUM APM; easiest integration
- **Datadog** — broader observability; more complex setup
- **New Relic** — similar to Datadog
- **Self-hosted** — InfluxDB + Grafana; full control but operational overhead

**For ItemTraxx**: Recommend **Sentry** (already used for error tracking; add RUM).

### Step 2: Set Up SDK Initialization

**Example: Sentry**

```typescript
// Location: src/main.ts

import * as Sentry from "@sentry/vue";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    new Sentry.Replay({
      maskAllText: true,
      blockAllMedia: true
    })
  ],
  tracesSampleRate: 0.1, // 10% of sessions for performance data
  replaysSessionSampleRate: 0.05, // 5% of sessions for session replay
  environment: import.meta.env.MODE
});
```

**.env.example**:
```
VITE_SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
```

### Step 3: Export getPerfMetricsSnapshot() to Provider

```typescript
// Location: src/services/perfTelemetry.ts

export function exportMetricsToObservability() {
  const metrics = getPerfMetricsSnapshot();
  
  metrics.forEach((metric) => {
    switch (metric.event) {
      case "edge_function_call_ms":
        Sentry.captureMessage("Edge function call", {
          level: "info",
          tags: { function: metric.label },
          measurements: { duration_ms: metric.duration }
        });
        break;
      
      case "cache_hit":
        Sentry.captureMessage("Cache operation", {
          level: "debug",
          tags: { cached: metric.cached },
          measurements: { latency_ms: metric.duration }
        });
        break;
      
      case "error":
        Sentry.captureMessage("Metric error", {
          level: "warning",
          tags: { errorType: metric.errorType, function: metric.label }
        });
        break;
    }
  });
}

// Call before session end (optional)
window.addEventListener("beforeunload", () => {
  exportMetricsToObservability();
});
```

### Step 4: Add Config to Environment

```bash
# .env (development)
VITE_SENTRY_DSN=https://examplePublicKey-dev@o0.ingest.sentry.io/0-dev
VITE_SENTRY_TRACES_SAMPLE_RATE=1.0  # 100% in dev for testing

# .env.production
VITE_SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% in prod to reduce quota
```

### Step 5: Verify Ingestion

```bash
npm run dev

# Trigger some edge function calls (e.g., login, admin ops)
# Check Sentry dashboard → Monitoring → Performance → Transaction list
# Should see entries like "admin-ops", "list_admin_tenants", etc.
```

---

## Example Dashboards

### Dashboard 1: Edge Function Performance

**Metric**: Average latency by function

```
SELECT 
  label as function_name,
  AVG(duration) as avg_latency_ms,
  PERCENTILE(duration, 0.95) as p95_latency_ms,
  COUNT(*) as call_count
FROM performance_metrics
WHERE event = 'edge_function_call_ms'
  AND timestamp > now() - interval '24 hours'
GROUP BY label
ORDER BY avg_latency_ms DESC;
```

**Expected rows**:
```
admin-ops           | 420ms  | 850ms | 1000 calls
list_admin_tenants  | 380ms  | 720ms | 800 calls
super-dashboard     | 650ms  | 1200ms | 200 calls
```

**Alert**: If p95 latency > 2000ms, investigate function performance.

### Dashboard 2: Cache Hit Rate

**Metric**: Cache effectiveness

```
SELECT 
  label as cache_key,
  COUNT(*) as total_accesses,
  SUM(CASE WHEN cached THEN 1 ELSE 0 END) as hits,
  100.0 * SUM(CASE WHEN cached THEN 1 ELSE 0 END) / COUNT(*) as hit_rate_pct
FROM performance_metrics
WHERE event = 'cache_hit'
  AND timestamp > now() - interval '24 hours'
GROUP BY label
ORDER BY hit_rate_pct DESC;
```

**Expected rows**:
```
tenant_options_*    | 800 accesses | 750 hits | 93.75% hit rate ✓
tenant_list         | 600 accesses | 450 hits | 75% hit rate ✓
district_dashboard  | 200 accesses | 80 hits  | 40% hit rate ⚠️ (consider longer TTL)
```

**Alert**: If hit rate < 50%, investigate cache TTL or key usage.

### Dashboard 3: Route Navigation Performance

**Metric**: Slowest page transitions

```
SELECT 
  label as route,
  COUNT(*) as navigations,
  AVG(duration) as avg_time_ms,
  PERCENTILE(duration, 0.95) as p95_time_ms,
  MAX(duration) as slowest_ms
FROM performance_metrics
WHERE event = 'route_navigation_ms'
  AND timestamp > now() - interval '24 hours'
GROUP BY label
ORDER BY avg_time_ms DESC
LIMIT 10;
```

**Expected rows**:
```
/admin              | 150 navigations | 480ms  | 920ms  | 2100ms
/admin/students     | 120 navigations | 520ms  | 1100ms | 2800ms
/admin/gear         | 100 navigations | 380ms  | 750ms  | 1400ms
```

**Alert**: If p95 > 1000ms for any route, performance regression likely.

### Dashboard 4: Error Rates by Type

**Metric**: Most common errors

```
SELECT 
  errorType as error_type,
  COUNT(*) as error_count,
  COUNT(*) * 100.0 / (SELECT COUNT(*) FROM performance_metrics) as error_rate_pct
FROM performance_metrics
WHERE event = 'error'
  AND timestamp > now() - interval '24 hours'
GROUP BY errorType
ORDER BY error_count DESC
LIMIT 10;
```

**Expected rows**:
```
TENANT_DISABLED       | 45 errors | 5.2% error rate
RATE_LIMIT_EXCEEDED   | 12 errors | 1.4% error rate
UNAUTHORIZED          | 8 errors  | 0.9% error rate
```

**Alert**: If TENANT_DISABLED errors spike, check for mass tenant disables.

---

## Monitoring & Alerts

### SLA Targets

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Admin operations (p95 latency) | < 500ms | > 1000ms for 10min |
| Route navigation (p95 latency) | < 600ms | > 1200ms for 10min |
| Cache hit rate | > 80% | < 50% for 30min |
| Error rate (all) | < 1% | > 5% for 5min |
| Edge function availability | > 99% | < 99% for 1min |

### Alert Examples (Sentry)

```
Alert: "Admin operations latency above SLA"
Trigger: transactions with tag function=admin-ops AND duration > 1000ms
Frequency: If 10+ occurrences in last 5 minutes
Action: Page on-call → investigate edge function or database query

Alert: "Cache hit rate below target"
Trigger: cache_hit metrics with hit_rate < 0.5
Frequency: If sustained > 30 minutes
Action: Review cache TTL configuration; consider longer windows
```

---

## Debugging

### Check Current Metrics Buffer (Dev Console)

```javascript
// In browser DevTools console
const metrics = window.__itemtraxx.perfTelemetry.getPerfMetricsSnapshot();
console.table(metrics);
```

### Export Metrics to CSV

```javascript
const metrics = window.__itemtraxx.perfTelemetry.getPerfMetricsSnapshot();
const csv = [
  ["event", "duration", "label", "cached", "errorType", "timestamp"],
  ...metrics.map(m => [
    m.event,
    m.duration || "",
    m.label || "",
    m.cached || "",
    m.errorType || "",
    m.timestamp
  ])
].map(row => row.join(",")).join("\n");

const blob = new Blob([csv], { type: "text/csv" });
const url = URL.createObjectURL(blob);
const link = document.createElement("a");
link.href = url;
link.download = `perf-metrics-${Date.now()}.csv`;
link.click();
```

### Performance Timeline (Sentry)

1. Navigate to Sentry → Monitoring → Performance
2. Select a transaction (e.g., "admin-ops edge function")
3. View span waterfall:
   - Network time (DNS, TCP, TLS)
   - Edge proxy time
   - Edge function execution
   - Database query time
4. Identify bottleneck (usually database)

---

## Best Practices

### 1. Sample Rates (Don't Ingest Everything)

```typescript
// Too verbose; high quota cost
const sampleRate = 1.0; // 100% — avoid!

// Recommended
const sampleRate = 0.1; // 10% of sessions in prod
```

### 2. PII Masking

Ensure no user data in metric labels:

```typescript
// ❌ Wrong: includes sensitive data
recordMetric({
  label: `student_${studentId}`, // student ID could be sensitive
  ...
});

// ✅ Right: generic labels
recordMetric({
  label: "student_query",
  tags: { entity: "student" }, // separate from sensitive data
  ...
});
```

### 3. Aggregate Metrics Locally Before Export

```typescript
// ❌ Wrong: send individual metric per call
recordMetric({ event: "cache_hit", ... }); // × 1000 per minute

// ✅ Right: batch aggregate every 60s
setInterval(() => {
  const summary = aggregateMetrics();
  exportToObservability(summary);
}, 60000);
```

### 4. Coordinate with Error Tracking

Sentry's error tracking already captures exceptions. RUM should focus on:
- Performance metrics (latency, cache, throughput)
- Availability (uptime)
- User experience (route nav, FCP)

**Don't duplicate**: If error is already caught by Sentry error handler, don't re-export in RUM.

---

## Related Documentation
- [Caching Strategy & TTL Registry](../caching-strategy.md) — monitor cache hit rates
- [Performance Budget](../performance/frontend-performance-pass-2026-02-23.md) — bundle size targets; correlate with RUM latency
- [Alerting Playbook](../operations/alerting-playbook.md) — incident response for RUM anomalies
