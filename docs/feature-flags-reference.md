# Feature Flags Reference

## Overview

ItemTraxx uses feature flags stored as JSONB in the `tenant_policies` table. Flags control UI visibility and backend feature availability. This document explains the architecture, available flags, and integration patterns.

---

## Flag Storage & Retrieval

### Database Schema

**Table**: `tenant_policies`

```sql
CREATE TABLE tenant_policies (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  feature_flags JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
```

### Feature Flags JSONB Structure

```json
{
  "enable_barcode_generator": true,
  "enable_custom_item_categories": false,
  "enable_advanced_search": true,
  "enable_multi_tenant_checkout": false,
  "enable_sms_notifications": true
}
```

### Retrieval Flow

```
1. User logs in
   ↓
2. Frontend calls admin-ops(action: "get_tenant_options")
   ↓
3. Backend:
   SELECT feature_flags FROM tenant_policies 
   WHERE tenant_id = ${tenant_id}
   ↓
4. Frontend stores in authState.tenantFeatureFlags
   ↓
5. Components check:
   if (authState.tenantFeatureFlags.enable_barcode_generator) {
     show barcode tool
   }
```

---

## Available Feature Flags

### Category: Checkout & Inventory

| Flag | Type | Default | Purpose | When To Use |
|------|------|---------|---------|------------|
| `enable_barcode_generator` | boolean | true | Show barcode generation tool in gear management | Test barcode workflow; disable for non-barcode orgs |
| `enable_custom_item_categories` | boolean | false | Allow custom gear categories beyond defaults | Large orgs needing taxonomy flexibility |
| `enable_advanced_search` | boolean | true | Full-text search in gear/student tables | Performance: disable if search slow |
| `enable_multi_tenant_checkout` | boolean | false | Allow cross-tenant gear checkout (beta) | Multi-location districts |

### Category: Notifications

| Flag | Type | Default | Purpose | When To Use |
|------|------|---------|---------|------------|
| `enable_sms_notifications` | boolean | true | Send SMS on checkout/return events | Disable for HIPAA/privacy compliance |
| `enable_email_digest` | boolean | true | Weekly email summary of activity | High-volume tenants may opt out |
| `enable_push_notifications` | boolean | false | Browser/mobile push on overdue items | Future: mobile app integration |

### Category: Reporting & Analytics

| Flag | Type | Default | Purpose | When To Use |
|------|------|---------|---------|------------|
| `enable_detailed_analytics` | boolean | true | Show detailed charts & export in dashboard | Performance: disable for slow connections |
| `enable_audit_log_export` | boolean | false | Allow download of full audit logs (CSV) | Compliance/security: enable for regulated orgs |

### Category: Experimental

| Flag | Type | Default | Purpose | When To Use |
|------|------|---------|---------|------------|
| `enable_offline_mode_beta` | boolean | false | Advanced offline queue with sync status UI | Early adopters; off for most users |
| `enable_ai_recommendations` | boolean | false | ML-based gear suggestions (backend stub) | Future: not yet implemented |

---

## Setting Feature Flags

### Option 1: Direct SQL Update (Admin)

```sql
-- Enable barcode for tenant
UPDATE tenant_policies
SET feature_flags = jsonb_set(
  feature_flags,
  '{enable_barcode_generator}',
  'true'::jsonb
)
WHERE tenant_id = ${tenant_id};
```

### Option 2: Backend API (Edge Function)

**Function**: `super-tenant-mutate` (action: `update_feature_flags`)

```typescript
// Frontend call
await invokeEdgeFunction("super-tenant-mutate", {
  action: "update_feature_flags",
  payload: {
    tenantId: "abc-123",
    flags: {
      enable_barcode_generator: true,
      enable_sms_notifications: false
    }
  },
  accessToken: await getFreshAccessToken()
});
```

**Backend implementation** (Deno):

```typescript
// supabase/functions/super-tenant-mutate/index.ts
if (action === "update_feature_flags") {
  const { tenantId, flags } = payload;
  
  const { error } = await adminClient
    .from("tenant_policies")
    .update({ feature_flags: flags })
    .eq("tenant_id", tenantId);
  
  if (error) throw error;
  
  return { success: true, updatedFlags: flags };
}
```

### Option 3: UI Control Panel (Future)

Propose super-admin dashboard:

```
Settings › Tenant Management › {TenantName} › Feature Flags
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Enable Barcode Generator
□ Enable Custom Item Categories
□ Enable Advanced Search
☑ Enable Multi-Tenant Checkout
□ Enable SMS Notifications
☑ Enable Email Digest
☑ Enable Push Notifications
□ Enable Detailed Analytics
□ Enable Audit Log Export
☑ Enable Offline Mode (Beta)
□ Enable AI Recommendations

[Save Changes]
```

---

## Frontend Integration Patterns

### Pattern 1: Conditional Rendering (Simple)

```vue
<!-- src/pages/tenant/GearManagement.vue -->
<script setup>
import { authState } from "@/store/authState";

const showBarcodeGenerator = () => 
  authState.tenantFeatureFlags?.enable_barcode_generator ?? false;
</script>

<template>
  <div class="gear-management">
    <!-- Always show inventory table -->
    <GearTable />
    
    <!-- Conditionally show barcode tool -->
    <section v-if="showBarcodeGenerator()" class="barcode-section">
      <BarcodeGenerator />
    </section>
  </div>
</template>
```

### Pattern 2: Feature-Gated Page (Route Guard)

```typescript
// src/router/index.ts

const routes = [
  {
    path: "/admin/analytics",
    component: AnalyticsDashboard,
    meta: {
      requiresSession: true,
      requiresRole: "tenant_admin",
      requiresFeatureFlag: "enable_detailed_analytics"
    }
  }
];

router.beforeEach((to, from, next) => {
  const requiredFlag = to.meta.requiresFeatureFlag;
  if (requiredFlag) {
    const flagEnabled = authState.tenantFeatureFlags?.[requiredFlag] ?? false;
    if (!flagEnabled) {
      return next("/admin?flag_disabled=true");
    }
  }
  next();
});
```

### Pattern 3: Feature-Gated Service (Behavior)

```typescript
// src/services/checkoutService.ts

export async function performCheckout(items: CheckoutItem[]) {
  const multiTenantEnabled = authState.tenantFeatureFlags?.enable_multi_tenant_checkout;
  
  if (!multiTenantEnabled) {
    // Enforce single-tenant rule
    const tenantsInCheckout = new Set(items.map(i => i.tenant_id));
    if (tenantsInCheckout.size > 1) {
      throw new Error("Cross-tenant checkout not allowed");
    }
  }
  
  // Proceed with checkout
  return await invokeEdgeFunction("checkoutReturn", {
    action: "checkout",
    payload: { items }
  });
}
```

### Pattern 4: Cached Flag Lookup (Performance)

```typescript
// src/composables/useFeatureFlag.ts

const featureFlagCache = new Map<string, boolean>();

export function useFeatureFlag(flagName: string): boolean {
  // Check cache first
  if (featureFlagCache.has(flagName)) {
    return featureFlagCache.get(flagName)!;
  }
  
  // Look up in authState
  const value = authState.tenantFeatureFlags?.[flagName] ?? false;
  
  // Cache result
  featureFlagCache.set(flagName, value);
  
  return value;
}

// Usage in component
const barcodesEnabled = useFeatureFlag("enable_barcode_generator");
```

---

## Backend Integration Patterns

### Pattern 1: RLS Policy Conditional

```sql
-- Audit log export only if enabled
CREATE POLICY audit_log_export_policy ON admin_audit_logs
  FOR SELECT
  USING (
    auth.uid() = actor_id
    AND (
      -- Check if feature enabled
      (SELECT feature_flags->>'enable_audit_log_export' 
       FROM tenant_policies 
       WHERE tenant_id = admin_audit_logs.tenant_id) = 'true'
    )
  );
```

### Pattern 2: Edge Function Logic

```typescript
// supabase/functions/admin-ops/index.ts

if (action === "get_search_results") {
  // Check if advanced search enabled
  const { data: policies } = await adminClient
    .from("tenant_policies")
    .select("feature_flags")
    .eq("tenant_id", tenant_id)
    .single();
  
  const advancedSearchEnabled = policies?.feature_flags?.enable_advanced_search;
  
  if (!advancedSearchEnabled) {
    return new Response(
      JSON.stringify({ error: "Advanced search not enabled for this tenant" }),
      { status: 403 }
    );
  }
  
  // Proceed with search
  return performSearch(query);
}
```

### Pattern 3: Database Feature Detection

```sql
-- Stored procedure to check if feature enabled
CREATE FUNCTION is_feature_enabled(
  p_tenant_id UUID,
  p_feature_name TEXT
) RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    feature_flags->>p_feature_name,
    'false'
  )::boolean
  FROM tenant_policies
  WHERE tenant_id = p_tenant_id;
$$ LANGUAGE SQL STABLE;

-- Usage in query
SELECT * FROM students
WHERE tenant_id = ${tenant_id}
  AND is_feature_enabled(tenant_id, 'enable_advanced_search');
```

---

## Observability & Testing

### Debugging: Check Current Flags

**In browser console:**

```javascript
console.log("Feature flags:", window.__$.authState.tenantFeatureFlags);
// Output: {
//   enable_barcode_generator: true,
//   enable_sms_notifications: false,
//   ...
// }
```

### Testing: Mock Flags in E2E

```typescript
// tests/e2e/feature-flags.spec.ts

describe("Feature Flags", () => {
  test("barcode generator visible when enabled", async ({ page }) => {
    await setAdminSession(page);
    
    // Override feature flags in mock
    await page.evaluate(() => {
      window.__itemtraxxTest.authState.tenantFeatureFlags = {
        enable_barcode_generator: true
      };
    });
    
    await page.goto("/admin/gear");
    
    const barcodeSection = await page.locator("text=Barcode Generator");
    await expect(barcodeSection).toBeVisible();
  });
  
  test("barcode generator hidden when disabled", async ({ page }) => {
    await setAdminSession(page);
    
    await page.evaluate(() => {
      window.__itemtraxxTest.authState.tenantFeatureFlags = {
        enable_barcode_generator: false
      };
    });
    
    await page.goto("/admin/gear");
    
    const barcodeSection = await page.locator("text=Barcode Generator");
    await expect(barcodeSection).not.toBeVisible();
  });
});
```

### Observability: Track Flag Usage

```typescript
// src/services/perfTelemetry.ts

export function recordFeatureFlagCheck(flagName: string, enabled: boolean) {
  recordMetric({
    event: "feature_flag_check",
    label: flagName,
    value: enabled ? 1 : 0,
    timestamp: Date.now()
  });
}

// Query in observability
SELECT 
  label as flag_name,
  SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) as enabled_count,
  SUM(CASE WHEN value = 0 THEN 1 ELSE 0 END) as disabled_count
FROM metrics
WHERE event = 'feature_flag_check'
  AND timestamp > now() - interval '24 hours'
GROUP BY label
ORDER BY enabled_count DESC;
```

---

## Migration Guide: Adding a New Flag

### Step 1: Define Flag in Database

```sql
-- Ensure tenant_policies table has row
INSERT INTO tenant_policies (tenant_id, feature_flags)
SELECT id, '{}'::jsonb
FROM tenants
WHERE id NOT IN (SELECT tenant_id FROM tenant_policies);

-- Set initial value for flag
UPDATE tenant_policies
SET feature_flags = jsonb_set(
  feature_flags,
  '{enable_new_feature}',
  'false'::jsonb  -- Default: disabled
);
```

### Step 2: Add TypeScript Type

```typescript
// src/types/edgeContracts.ts

export interface TenantFeatureFlags {
  enable_barcode_generator?: boolean;
  enable_custom_item_categories?: boolean;
  enable_advanced_search?: boolean;
  enable_multi_tenant_checkout?: boolean;
  enable_sms_notifications?: boolean;
  enable_email_digest?: boolean;
  enable_push_notifications?: boolean;
  enable_detailed_analytics?: boolean;
  enable_audit_log_export?: boolean;
  enable_offline_mode_beta?: boolean;
  enable_ai_recommendations?: boolean;
  enable_new_feature?: boolean;  // Add new flag here
}
```

### Step 3: Add Frontend Integration

```vue
<!-- src/pages/admin/NewFeature.vue -->
<script setup>
import { authState } from "@/store/authState";

const isFeatureEnabled = () => 
  authState.tenantFeatureFlags?.enable_new_feature ?? false;
</script>

<template>
  <section v-if="isFeatureEnabled()" class="new-feature">
    <!-- Feature UI -->
  </section>
  <section v-else class="feature-disabled">
    <p>This feature is not enabled for your tenant.</p>
  </section>
</template>
```

### Step 4: Add Backend Support (If Needed)

```typescript
// supabase/functions/admin-ops/index.ts

if (action === "new_feature_action") {
  const flagEnabled = await isFeatureEnabled(tenant_id, "enable_new_feature");
  
  if (!flagEnabled) {
    return new Response(
      JSON.stringify({ error: "Feature not enabled" }),
      { status: 403 }
    );
  }
  
  // Implement feature logic
  return handleNewFeature(payload);
}
```

### Step 5: Test

```bash
# Test with flag disabled (default)
npm run test:e2e tests/e2e/features.spec.ts

# Manual flag override for testing
# In browser console:
window.__itemtraxx.authState.tenantFeatureFlags.enable_new_feature = true;
```

### Step 6: Document Changes

- Add flag description to feature flags reference
- Add deployment notes (which tenants get flag enabled by default?)
- Add rollback plan (if bugs discovered, disable flag immediately via SQL)

---

## Best Practices

### 1. Default to Disabled (Safe)
```typescript
// ❌ Wrong: new features on by default
enable_new_feature: true

// ✅ Right: new features off by default
enable_new_feature: false
```

### 2. Use Short, Descriptive Names
```typescript
// ❌ Wrong: vague
new_feature: true
beta_flag_2: true

// ✅ Right: clear purpose
enable_barcode_generator: true
enable_audit_log_export: true
```

### 3. Version Your Flags
```typescript
// As features mature, retire old flags
enable_offline_mode_beta: false  // Matured → enable_offline_mode (new flag)
enable_offline_mode_v2: true     // Clearer than "beta"
```

### 4. Cache Flags Aggressively (But Invalidate on Change)
- Cache in `authState` after login
- If flag changes (super-admin updates), invalidate cache
- Or, use short TTL (5min) on flag lookups

### 5. Audit Flag Changes
```sql
-- Log all flag updates
CREATE TRIGGER audit_feature_flag_changes
AFTER UPDATE ON tenant_policies
FOR EACH ROW
EXECUTE FUNCTION log_audit_event('tenant_policies_updated', NEW.feature_flags);
```

---

## Related Documentation
- [Tenant Admin Performance Guide](../tenant-admin-performance-guide.md) — flags impact on dashboard performance
- [Session Refresh & Auth Flow](../runbooks/session-refresh-and-auth-flow.md) — refresh flags on auth refresh
- [Caching Strategy](../caching-strategy.md) — cache tenant_options includes feature_flags
