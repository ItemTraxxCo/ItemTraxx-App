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
  assertEquals(
    isValidTenantPlanForAccountCategory("individual", "individual_yearly"),
    true,
  );
  assertEquals(
    isValidTenantPlanForAccountCategory("individual", "starter"),
    false,
  );
  assertEquals(isValidTenantPlanForAccountCategory("district", "growth"), true);
  assertEquals(
    isValidTenantPlanForAccountCategory("organization", "scale"),
    true,
  );
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
      {
        includeAccountCategory: true,
        includePlanCode: true,
        includeFeatureFlags: true,
      },
      {
        code: "PGRST204",
        message: "Could not find the 'feature_flags' column",
      },
    ),
    {
      includeAccountCategory: true,
      includePlanCode: true,
      includeFeatureFlags: false,
    },
  );
  assertEquals(
    nextTenantPolicyFallback(
      {
        includeAccountCategory: true,
        includePlanCode: true,
        includeFeatureFlags: false,
      },
      {
        code: "PGRST204",
        message: "Could not find the 'account_category' column",
      },
    ),
    {
      includeAccountCategory: false,
      includePlanCode: true,
      includeFeatureFlags: false,
    },
  );
  assertEquals(
    nextTenantPolicyFallback(
      {
        includeAccountCategory: false,
        includePlanCode: true,
        includeFeatureFlags: false,
      },
      { code: "PGRST204", message: "Could not find the 'plan_code' column" },
    ),
    {
      includeAccountCategory: false,
      includePlanCode: false,
      includeFeatureFlags: false,
    },
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

const testJsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: status < 400, ...body }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const contextFor = (
  action: string,
  payload: Record<string, unknown>,
  adminClient: unknown,
  writeAudit: SuperTenantContext["writeAudit"] = async () => {},
) =>
  ({
    req: new Request(
      "https://example.test/functions/v1/super-tenant-mutate",
      { method: "POST" },
    ),
    action,
    payload,
    userClient: {},
    adminClient,
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "admin@example.test",
    },
    profile: { auth_email: "admin@example.test" },
    jsonResponse: testJsonResponse,
    writeAudit,
    resetRedirectTo: "https://app.example.test/reset-password",
    supabaseUrl: "https://supabase.example.test",
    publishableKey: "test-publishable-key",
  }) as unknown as SuperTenantContext;

const queryResult = (result: Record<string, unknown>) => {
  const query: Record<string, unknown> = {};
  for (
    const method of [
      "select",
      "insert",
      "update",
      "delete",
      "upsert",
      "eq",
      "in",
      "gte",
      "order",
      "limit",
    ]
  ) {
    query[method] = () => query;
  }
  query.single = () => Promise.resolve(result);
  query.maybeSingle = () => Promise.resolve(result);
  query.then = (
    resolve: (value: Record<string, unknown>) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
};

Deno.test("super tenant dispatcher preserves a representative tenant read", async () => {
  const adminClient = {
    from: () => queryResult({ data: [], error: null }),
  };

  const response = await dispatchSuperTenantAction(
    contextFor(
      "list_tenants",
      { search: "", status: "all" },
      adminClient,
    ),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, data: [] });
});

Deno.test("super tenant dispatcher preserves an audited district write", async () => {
  const district = {
    id: "00000000-0000-4000-8000-000000000002",
    name: "North District",
    slug: "north-district",
    support_email: null,
    contact_name: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    subscription_plan: "district_core",
    billing_status: "active",
    renewal_date: null,
    billing_email: null,
    invoice_reference: null,
  };
  const auditCalls: unknown[][] = [];
  const adminClient = {
    from: (table: string) =>
      queryResult(
        table === "districts"
          ? { data: district, error: null }
          : { data: [], error: null },
      ),
  };

  const response = await dispatchSuperTenantAction(
    contextFor(
      "update_district",
      {
        id: district.id,
        name: district.name,
        slug: district.slug,
        is_active: true,
        subscription_plan: "district_core",
        billing_status: "active",
      },
      adminClient,
      async (...args) => {
        auditCalls.push(args);
      },
    ),
  );

  assertEquals(response.status, 200);
  assertEquals((await response.json()).data.id, district.id);
  assertEquals(auditCalls, [[
    "update_district",
    "district",
    district.id,
    {
      district_name: district.name,
      district_slug: district.slug,
      is_active: true,
      subscription_plan: "district_core",
      billing_status: "active",
    },
  ]]);
});

Deno.test("super tenant dispatcher preserves a representative database error", async () => {
  const adminClient = {
    from: () => queryResult({ data: null, error: { message: "db down" } }),
  };

  const response = await dispatchSuperTenantAction(
    contextFor("list_districts", { search: "" }, adminClient),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    ok: false,
    error: "Unable to load districts.",
  });
});

Deno.test("tenant creation preserves auth-failure tenant rollback", async () => {
  const tenant = {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Demo Tenant",
    access_code: "DEMO-123",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    district_id: null,
    primary_admin_profile_id: null,
  };
  const operations: Array<{ table: string; method: string; value?: unknown }> =
    [];
  const adminClient = {
    auth: {
      admin: {
        createUser: async () => ({
          data: { user: null },
          error: { message: "provider unavailable" },
        }),
      },
    },
    from: (table: string) => {
      const methods: string[] = [];
      const query: Record<string, unknown> = {};
      for (const method of ["select", "insert", "delete", "eq"]) {
        query[method] = (value?: unknown) => {
          methods.push(method);
          operations.push({ table, method, value });
          return query;
        };
      }
      const result = () =>
        table === "tenants" && methods.includes("insert")
          ? { data: tenant, error: null }
          : { data: null, error: null };
      query.single = () => Promise.resolve(result());
      query.maybeSingle = () => Promise.resolve(result());
      query.then = (
        resolve: (value: Record<string, unknown>) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(result()).then(resolve, reject);
      return query;
    },
  };

  const response = await dispatchSuperTenantAction(
    contextFor(
      "create_tenant",
      {
        name: tenant.name,
        access_code: tenant.access_code,
        auth_email: "tenant-admin@example.test",
        password: "strong-password",
        status: "active",
      },
      adminClient,
    ),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    ok: false,
    error: "Unable to create auth user.",
  });
  assertEquals(
    operations.some(
      (operation) =>
        operation.table === "tenants" && operation.method === "delete",
    ),
    true,
  );
});
