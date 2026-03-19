# Device Session ID Pattern & Session Continuity

## Overview

ItemTraxx maintains session continuity across browser tabs and offline scenarios via a **device session ID** stored in localStorage. This document explains the pattern and integration with the offline queue.

---

## What Is Device Session ID?

### Purpose

- **Session tracking**: Identify the same browser/device across multiple tabs
- **Offline queue persistence**: Associate buffered checkouts with a device, not a user session
- **Analytics**: Track user journeys across sessions (opt-in, privacy-respecting)

### Storage

**Key**: `itemtraxx:device-session-id:v1`

**Value**: UUID v4 (generated at first visit)

**Example**:
```
itemtraxx:device-session-id:v1 = "550e8400-e29b-41d4-a716-446655440000"
```

### Generated When

- First page load (if no device ID in localStorage)
- Persisted across browser restarts
- Cleared on browser data wipe (user action)
- Shared across all tabs for same domain

---

## Implementation

### Generation & Caching

```typescript
// Location: src/services/deviceSessionService.ts (proposed)

const DEVICE_SESSION_KEY = "itemtraxx:device-session-id:v1";

export function getOrCreateDeviceSessionId(): string {
  let deviceId = localStorage.getItem(DEVICE_SESSION_KEY);
  
  if (!deviceId) {
    // Generate UUID v4
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_SESSION_KEY, deviceId);
    
    // Log telemetry
    recordMetric({
      event: "device_session_created",
      label: deviceId,
      timestamp: Date.now()
    });
  }
  
  return deviceId;
}

export function clearDeviceSession(): void {
  localStorage.removeItem(DEVICE_SESSION_KEY);
}
```

### Integration with Checkout Queue

```typescript
// Location: src/services/checkoutService.ts

interface BufferedCheckoutItem {
  id: string;
  studentId: string;
  gearId: string;
  deviceSessionId: string;  // ← Device session ID
  timestamp: number;
  createdAt: number;
  syncAttempts: number;
}

export async function bufferCheckout(item: CheckoutItem): Promise<void> {
  const buffer = JSON.parse(
    localStorage.getItem("itemtraxx:checkout-offline-buffer:v1") || "[]"
  ) as BufferedCheckoutItem[];
  
  const bufferedItem: BufferedCheckoutItem = {
    ...item,
    id: crypto.randomUUID(),
    deviceSessionId: getOrCreateDeviceSessionId(),  // Attach device ID
    timestamp: Date.now(),
    createdAt: Date.now(),
    syncAttempts: 0
  };
  
  buffer.push(bufferedItem);
  localStorage.setItem(
    "itemtraxx:checkout-offline-buffer:v1",
    JSON.stringify(buffer)
  );
}

export async function syncBufferedCheckouts(): Promise<void> {
  const buffer = JSON.parse(
    localStorage.getItem("itemtraxx:checkout-offline-buffer:v1") || "[]"
  ) as BufferedCheckoutItem[];
  
  const deviceId = getOrCreateDeviceSessionId();
  
  for (const item of buffer) {
    // Only sync items from this device
    if (item.deviceSessionId !== deviceId) {
      continue;
    }
    
    try {
      await invokeEdgeFunction("checkoutReturn", {
        action: "checkout",
        payload: {
          studentId: item.studentId,
          gearId: item.gearId,
          deviceSessionId: item.deviceSessionId  // Send to backend
        }
      });
      
      // Remove from buffer on success
      buffer.splice(buffer.indexOf(item), 1);
    } catch (error) {
      item.syncAttempts++;
      
      // Backoff: after 5 attempts, stop retrying
      if (item.syncAttempts > 5) {
        console.warn("Checkout sync exhausted retries:", item);
      }
    }
  }
  
  localStorage.setItem(
    "itemtraxx:checkout-offline-buffer:v1",
    JSON.stringify(buffer)
  );
}
```

---

## Data Flow: Multi-Tab Sync

### Scenario: User Opens App in Two Tabs

```
Tab A (Admin panel)           Tab B (Checkout)
│                             │
├─ Read device session ID     ├─ Read device session ID
│  from localStorage          │  from localStorage
│  → "550e8400..."            │  → "550e8400..." (same!)
│                             │
├─ Make admin query           ├─ Buffer offline checkouts
│  Send: deviceSessionId      │  Attach: deviceSessionId
│                             │
└─ Results tagged with        └─ Items tagged with same ID
  "Tab A origin"               "Tab B origin"
```

When connection restored:
- Tab B syncs buffered checkouts
- Backend correlates with device ID (not user session)
- If user in different tenant → checkout rejected by RLS
- Device ID purely for **session continuity**, not authorization

---

## Backend Integration

### Edge Function: Attach Device Session ID

```typescript
// supabase/functions/checkoutReturn/index.ts

Deno.serve(async (req: Request) => {
  const { action, payload } = await req.json();
  
  if (action === "checkout") {
    const { studentId, gearId, deviceSessionId } = payload;
    
    // 1. Validate user authorization (via JWT)
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    
    // 2. Validate tenant access
    const tenantId = await getCurrentTenantId(user.id);
    
    // 3. Log device session (for analytics)
    await adminClient.from("checkout_logs").insert({
      tenant_id: tenantId,
      user_id: user.id,
      device_session_id: deviceSessionId,  // Store for correlation
      student_id: studentId,
      gear_id: gearId,
      action: "checkout",
      metadata: {
        source: "offline_sync",  // Indicates buffered checkout
        synced_at: new Date().toISOString()
      },
      created_at: new Date().toISOString()
    });
    
    // 4. Proceed with checkout
    return await executeCheckout(tenantId, studentId, gearId);
  }
});
```

### Database: Correlate Device Sessions

```sql
-- Track device sessions for analytics
CREATE TABLE device_sessions (
  id UUID PRIMARY KEY,
  device_id UUID NOT NULL,  -- Device session ID from client
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  first_seen_at TIMESTAMP NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMP NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (user_id) REFERENCES profiles(id)
);

-- On every checkout from offline buffer, update last_activity
UPDATE device_sessions
SET last_activity_at = now()
WHERE device_id = ${deviceSessionId}
  AND tenant_id = ${tenantId};

-- Query: which devices checked out gear today?
SELECT DISTINCT device_id, COUNT(*) as checkout_count
FROM checkout_logs
WHERE created_at > now() - interval '24 hours'
  AND action = 'checkout'
  AND metadata->>'source' = 'offline_sync'
GROUP BY device_id
ORDER BY checkout_count DESC;
```

---

## Privacy & Security Considerations

### 1. Device ID ≠ User ID

**Important**: Device session ID is **not** an authentication token.

```typescript
// ❌ Wrong: using device ID for auth
if (payload.deviceSessionId === authorizedDeviceId) {
  allow operation
}

// ✅ Right: auth via JWT; device ID for analytics only
const user = await getUserFromJWT(authHeader);
if (!user) return 403;
// Device ID is metadata, not used for authorization
```

### 2. Persistence & Clearing

- Device ID persists until browser cache cleared (user intent)
- Different browsers = different device IDs (not tracked across browsers)
- New incognito session = new device ID each time

```typescript
// User logs out; should device ID persist?
export async function logout() {
  // Keep device session (analytics continuity)
  // Clear auth session
  authState.session = null;
  authState.user = null;
  
  // Device ID remains for future sessions
  // User can manually clear in browser settings
}
```

### 3. PII Leakage Prevention

Do NOT embed user data in device session:

```typescript
// ❌ Wrong: user data in device ID
const deviceId = `device_${user.id}_${user.email}`;

// ✅ Right: pure UUID, no PII
const deviceId = crypto.randomUUID();
```

### 4. Cross-Domain Isolation

Device IDs are **per-domain** (localStorage scope):

```
app.itemtraxx.com:device:550e8400-...       ← Device A
district.app.itemtraxx.com:device:770f9500-... ← Device B (even if same browser!)
itemtraxx.com:device:990g0611-...           ← Device C

// Each domain has separate device ID; cross-tenant leaks prevented by browser SOP
```

---

## Use Cases

### Use Case 1: Offline Checkout Sync

```
User checks out 10 items while offline
  ↓
Items buffered with device ID
  ↓
Connection restored
  ↓
Frontend syncs all 10 checkouts
  ↓
Backend logs: "Device 550e8400 synced 10 checkouts"
  ↓
Analytics: "This device is a heavy user"
```

### Use Case 2: Cross-Tab Coordination

```
User opens app in Tab A (admin login)
  ↓
User opens app in Tab B (same session, different tab)
  ↓
Both tabs share localStorage (including device ID)
  ↓
Both tabs can read offline queue
  ↓
If Tab B syncs queue, Tab A sees update (via storage event listener)
```

### Use Case 3: Session Resumption

```
User logs in on Device A
  ↓
Closes browser
  ↓
Opens app 3 days later
  ↓
Same device ID (localStorage persisted)
  ↓
Backend: "Device 550e8400 is back"
  ↓
Analytics: "Device retention: 3 days"
```

---

## Observability

### Metrics to Track

```typescript
export function recordDeviceSessionMetrics() {
  const deviceId = getOrCreateDeviceSessionId();
  
  recordMetric({
    event: "device_session_active",
    label: deviceId,
    value: 1,
    metadata: {
      userAgent: navigator.userAgent,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    timestamp: Date.now()
  });
}

// Query: device retention
SELECT 
  device_id,
  COUNT(DISTINCT DATE(timestamp)) as active_days,
  MAX(timestamp) as last_active
FROM metrics
WHERE event = 'device_session_active'
  AND timestamp > now() - interval '90 days'
GROUP BY device_id
ORDER BY active_days DESC;
```

### Dashboard: Device Session Health

```
Metrics:
- Total unique devices: 1,200
- Devices with offline checkouts: 340 (28%)
- Avg offline queue size: 2.4 items
- Avg sync latency: 45 seconds
- Failed syncs: 12 (0.5%)
```

---

## Testing

### Unit Test: Device ID Persistence

```typescript
// tests/e2e/device-session.spec.ts

describe("Device Session ID", () => {
  test("should persist across page reloads", async ({ page }) => {
    await page.goto("/");
    
    const deviceId1 = await page.evaluate(() => 
      window.__$.getOrCreateDeviceSessionId()
    );
    
    await page.reload();
    
    const deviceId2 = await page.evaluate(() => 
      window.__$.getOrCreateDeviceSessionId()
    );
    
    expect(deviceId1).toBe(deviceId2);
  });
  
  test("should be different across incognito sessions", async ({ browser }) => {
    const page1 = await browser.newPage();
    const page2 = await browser.newPage({ offline: true });
    
    const deviceId1 = await page1.evaluate(() => 
      window.__$.getOrCreateDeviceSessionId()
    );
    
    const deviceId2 = await page2.evaluate(() => 
      window.__$.getOrCreateDeviceSessionId()
    );
    
    expect(deviceId1).not.toBe(deviceId2);
  });
});
```

### Integration Test: Offline Sync with Device ID

```typescript
test("should attach device ID to offline checkouts", async ({ page }) => {
  await page.goto("/");
  
  // Go offline
  await page.context().setOffline(true);
  
  // Buffer checkout
  await page.click("button:has-text('Checkout')");
  
  // Verify buffer
  const buffer = await page.evaluate(() => 
    JSON.parse(localStorage.getItem("itemtraxx:checkout-offline-buffer:v1") || "[]")
  );
  
  expect(buffer[0]).toHaveProperty("deviceSessionId");
  expect(buffer[0].deviceSessionId).toMatch(/^[0-9a-f-]*$/); // UUID format
  
  // Come online
  await page.context().setOffline(false);
  
  // Verify sync includes device ID
  const syncRequest = await page.waitForEvent("requestfinished", 
    req => req.url().includes("checkoutReturn")
  );
  
  const payload = await JSON.parse(syncRequest.postDataBuffer());
  expect(payload.deviceSessionId).toBeDefined();
});
```

---

## Migration Guide

### For Existing Passive Users (No Change Required)

```typescript
// Device ID auto-generated on first access
// Existing users: device ID created on next visit
// No data migration needed
```

### For Analytics Setup

1. Start recording `device_session_active` metrics
2. Backfill historical data (query checkout_logs for device_id)
3. Set up dashboards to visualize device retention

---

## Best Practices

### 1. Always Use UUID v4 for Device ID
```typescript
// ❌ Wrong: non-random
const deviceId = Date.now().toString();

// ✅ Right: cryptographically random
const deviceId = crypto.randomUUID();
```

### 2. Never Send Device ID Outside Own Domain
```typescript
// ❌ Wrong: sending device ID to third-party analytics
fetch(`https://analytics.com/track?deviceId=${deviceId}`);

// ✅ Right: keep device ID internal; send anonymized metrics
fetch(`${BACKEND}/metrics`, { body: JSON.stringify({ event: "checkout" }) });
```

### 3. Coordinate with Auth State
```typescript
// Clear auth but keep device ID
logout() {
  authState.session = null;      // Clear
  // Do NOT clear device session
}
```

### 4. Handle localStorage Quota
```typescript
// If offline queue is large, device ID storage may be limited
try {
  localStorage.setItem(DEVICE_SESSION_KEY, deviceId);
} catch (error) {
  if (error.name === "QuotaExceededError") {
    console.warn("localStorage full; clearing old entries");
    clearOldOfflineItems();
    localStorage.setItem(DEVICE_SESSION_KEY, deviceId);
  }
}
```

---

## Related Documentation
- [Offline Queue Design](offline-queue-design.md) — detailed offline sync behavior
- [Session Refresh & Auth Flow](runbooks/session-refresh-and-auth-flow.md) — device ID vs auth token distinction
- [Performance Telemetry](performance/telemetry-ingestion.md) — device-level analytics
