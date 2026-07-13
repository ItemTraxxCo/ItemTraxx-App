import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  dispatchSuperTenantAction,
  SUPER_TENANT_ACTIONS,
} from "./actions/index.ts";
import {
  describeDistrictWriteError,
  isValidDistrictBillingStatus,
  isValidDistrictPlan,
  normalizeDistrictSlug,
} from "./actions/districts.ts";
import {
  describeTenantWriteError,
  isValidTenantAccountCategory,
  isValidTenantPlanForAccountCategory,
  isValidTenantStatus,
  nextTenantPolicyFallback,
} from "./actions/tenantWrites.ts";
import { tenantPolicySelectFallback } from "./actions/tenantQueries.ts";
import { resolveResetRedirectTo } from "./actions/primaryAdmins.ts";
import type { SuperTenantContext } from "./context.ts";

const EXPECTED_ACTIONS = [
  "list_tenants",
  "list_districts",
  "create_district",
  "update_district",
  "get_district_details",
  "create_tenant",
  "update_tenant",
  "set_tenant_status",
  "send_primary_admin_reset",
  "set_primary_admin",
] as const;

Deno.test("super tenant registry contains exactly the 10 live actions", () => {
  assertEquals(SUPER_TENANT_ACTIONS.length, 10);
  assertEquals(new Set(SUPER_TENANT_ACTIONS).size, 10);
  assertEquals([...SUPER_TENANT_ACTIONS].sort(), [...EXPECTED_ACTIONS].sort());
});

Deno.test("super tenant dispatcher preserves the invalid-action response", async () => {
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: status < 400, ...body }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const response = await dispatchSuperTenantAction({
    action: "not_a_live_action",
    payload: {},
    jsonResponse,
  } as unknown as SuperTenantContext);

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { ok: false, error: "Invalid action" });
});

Deno.test("district validators preserve slug, plan, and billing contracts", () => {
  assertEquals(normalizeDistrictSlug(" North / Central -- "), "north-central");
  assertEquals(normalizeDistrictSlug("---"), "");
  assertEquals(isValidDistrictPlan("district_core"), true);
  assertEquals(isValidDistrictPlan("enterprise"), false);
  assertEquals(isValidDistrictBillingStatus("past_due"), true);
  assertEquals(isValidDistrictBillingStatus("paused"), false);
});

Deno.test("tenant validators preserve status, account-category, and plan compatibility", () => {
  assertEquals(isValidTenantStatus("suspended"), true);
  assertEquals(isValidTenantStatus("disabled"), false);
  assertEquals(isValidTenantAccountCategory("individual"), true);
  assertEquals(isValidTenantAccountCategory("school"), false);
  assertEquals(isValidTenantPlanForAccountCategory("individual", "individual_yearly"), true);
  assertEquals(isValidTenantPlanForAccountCategory("individual", "starter"), false);
  assertEquals(isValidTenantPlanForAccountCategory("district", "growth"), true);
  assertEquals(isValidTenantPlanForAccountCategory("organization", "scale"), true);
  assertEquals(isValidTenantPlanForAccountCategory("organization", null), true);
});

Deno.test("duplicate slug and access-code errors keep their response messages", () => {
  assertEquals(
    describeDistrictWriteError("Unable to create district.", {
      code: "23505",
      message: "duplicate key violates districts_slug_key",
    }),
    "District slug already exists.",
  );
  assertEquals(
    describeTenantWriteError("Unable to create tenant.", {
      code: "23505",
      message: "duplicate key violates tenants_access_code_key",
    }),
    "Unable to create tenant.",
  );
});

Deno.test("missing-column fallbacks preserve select and upsert retry order", () => {
  assertEquals(
    tenantPolicySelectFallback({
      code: "PGRST204",
      message: "Could not find the 'feature_flags' column",
    }),
    "tenant_id, checkout_due_hours, account_category, plan_code",
  );
  assertEquals(
    nextTenantPolicyFallback(
      { includeAccountCategory: true, includePlanCode: true, includeFeatureFlags: true },
      { code: "PGRST204", message: "Could not find the 'feature_flags' column" },
    ),
    { includeAccountCategory: true, includePlanCode: true, includeFeatureFlags: false },
  );
  assertEquals(
    nextTenantPolicyFallback(
      { includeAccountCategory: true, includePlanCode: true, includeFeatureFlags: false },
      { code: "PGRST204", message: "Could not find the 'account_category' column" },
    ),
    { includeAccountCategory: false, includePlanCode: true, includeFeatureFlags: false },
  );
  assertEquals(
    nextTenantPolicyFallback(
      { includeAccountCategory: false, includePlanCode: true, includeFeatureFlags: false },
      { code: "PGRST204", message: "Could not find the 'plan_code' column" },
    ),
    { includeAccountCategory: false, includePlanCode: false, includeFeatureFlags: false },
  );
});

Deno.test("password resets use only the configured redirect allowlist entry", () => {
  assertEquals(
    resolveResetRedirectTo(" https://app.itemtraxx.test/reset-password "),
    "https://app.itemtraxx.test/reset-password",
  );
  assertEquals(resolveResetRedirectTo(""), null);
  assertEquals(resolveResetRedirectTo(undefined), null);
});
