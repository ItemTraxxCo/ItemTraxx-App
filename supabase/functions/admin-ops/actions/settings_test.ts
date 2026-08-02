import {
  defaultFeatureFlags,
  handleSettingsAction,
  normalizeFeatureFlags,
  resolveWorkspacePolicyState,
} from "./settings.ts";
import type { AdminOpsContext, SupabaseClient } from "../context.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

type QueryCall = {
  table: string;
  operations: Array<{ method: string; args: unknown[] }>;
};

type QueryResult = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number | null;
};

const makeClient = (
  respond: (call: QueryCall) => QueryResult | Promise<QueryResult>,
) => {
  const calls: QueryCall[] = [];

  const from = (table: string) => {
    const operations: QueryCall["operations"] = [];
    const query: Record<string, unknown> = {};
    const record = (method: string, args: unknown[]) => {
      operations.push({ method, args });
      return query;
    };
    for (
      const method of [
        "select",
        "insert",
        "update",
        "upsert",
        "delete",
        "eq",
        "neq",
        "is",
        "not",
        "in",
        "gte",
        "gt",
        "lte",
        "order",
        "limit",
      ]
    ) {
      query[method] = (...args: unknown[]) => record(method, args);
    }
    const resolve = () => {
      const call = { table, operations: [...operations] };
      calls.push(call);
      return Promise.resolve(respond(call));
    };
    query.single = () => {
      operations.push({ method: "single", args: [] });
      return resolve();
    };
    query.maybeSingle = () => {
      operations.push({ method: "maybeSingle", args: [] });
      return resolve();
    };
    query.then = (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => resolve().then(onFulfilled, onRejected);
    return query;
  };

  return {
    client: { from } as unknown as SupabaseClient,
    calls,
  };
};

const baseContext = (
  adminClient: SupabaseClient,
  overrides: Partial<AdminOpsContext> = {},
): AdminOpsContext => ({
  requestId: "request-1",
  action: "get_workspace_settings",
  payload: {},
  adminClient,
  user: { id: "00000000-0000-4000-8000-000000000001" },
  workspaceId: "00000000-0000-4000-8000-000000000002",
  authToken: "test-auth-token",
  authSessionBinding: { sessionId: "auth-session-1", issuedAt: null },
  authTokenBindingKey: "session:auth-session-1",
  deviceSession: {
    deviceId: null,
    deviceLabel: null,
    userAgent: null,
    loginMethod: null,
    loginLocation: null,
    generalLocation: null,
  },
  workspacePolicy: null,
  checkoutDueHours: 72,
  featureFlags: defaultFeatureFlags(),
  maintenance: { enabled: false, message: "" },
  workspaceUpdates: [],
  jsonResponse: (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ...overrides,
});

const bodyOf = (response: Response) =>
  response.json() as Promise<Record<string, unknown>>;

// ---- defaultFeatureFlags / normalizeFeatureFlags ----

Deno.test("defaultFeatureFlags returns all flags enabled", () => {
  const flags = defaultFeatureFlags();
  assert(flags.enable_notifications === true, "expected notifications enabled");
  assert(flags.enable_bulk_item_import === true, "expected bulk item import enabled");
  assert(flags.enable_bulk_borrower_tools === true, "expected bulk borrower tools enabled");
  assert(flags.enable_status_tracking === true, "expected status tracking enabled");
  assert(flags.enable_barcode_generator === true, "expected barcode generator enabled");
});

Deno.test("normalizeFeatureFlags falls back to defaults for non-object input", () => {
  const flags = normalizeFeatureFlags(null);
  assert(flags.enable_notifications === true, "expected default flags for null input");
  const flagsUndefined = normalizeFeatureFlags(undefined);
  assert(flagsUndefined.enable_status_tracking === true, "expected default flags for undefined input");
  const flagsString = normalizeFeatureFlags("nope");
  assert(flagsString.enable_barcode_generator === true, "expected default flags for string input");
});

Deno.test("normalizeFeatureFlags preserves explicit booleans and defaults invalid ones", () => {
  const flags = normalizeFeatureFlags({
    enable_notifications: false,
    enable_bulk_item_import: "yes",
    enable_bulk_borrower_tools: false,
    enable_status_tracking: 1,
    enable_barcode_generator: false,
  });
  assert(flags.enable_notifications === false, "expected explicit false to be preserved");
  assert(flags.enable_bulk_item_import === true, "expected non-boolean to fall back to default");
  assert(flags.enable_bulk_borrower_tools === false, "expected explicit false to be preserved");
  assert(flags.enable_status_tracking === true, "expected non-boolean to fall back to default");
  assert(flags.enable_barcode_generator === false, "expected explicit false to be preserved");
});

// ---- resolveWorkspacePolicyState ----

Deno.test("resolveWorkspacePolicyState returns defaults when no policy row exists", async () => {
  const { client } = makeClient(() => ({ data: null, error: null }));
  const resolved = await resolveWorkspacePolicyState(client, "workspace-1");

  assert(resolved.checkoutDueHours === 72, "expected default checkout due hours");
  assert(resolved.featureFlags.enable_notifications === true, "expected default flags");
  assert(resolved.workspacePolicy === null, "expected null workspace policy");
});

Deno.test("resolveWorkspacePolicyState clamps checkout_due_hours to the valid range", async () => {
  const { client: highClient } = makeClient(() => ({
    data: {
      checkout_due_hours: 5000,
      account_category: "workspace",
      plan_code: "workspace_growth",
      feature_flags: null,
    },
    error: null,
  }));
  const high = await resolveWorkspacePolicyState(highClient, "workspace-1");
  assert(high.checkoutDueHours === 720, `expected clamp to 720, got ${high.checkoutDueHours}`);

  const { client: lowClient } = makeClient(() => ({
    data: {
      checkout_due_hours: 0,
      account_category: "workspace",
      plan_code: "workspace_growth",
      feature_flags: null,
    },
    error: null,
  }));
  const low = await resolveWorkspacePolicyState(lowClient, "workspace-1");
  assert(low.checkoutDueHours === 1, `expected clamp to 1, got ${low.checkoutDueHours}`);
});

Deno.test("resolveWorkspacePolicyState falls back to defaults on an unrelated query error", async () => {
  const { client } = makeClient(() => ({
    data: null,
    error: { code: "500", message: "server exploded" },
  }));
  const resolved = await resolveWorkspacePolicyState(client, "workspace-1");

  assert(resolved.checkoutDueHours === 72, "expected default checkout due hours on error");
  assert(resolved.featureFlags.enable_notifications === true, "expected default flags on error");
});

// ---- handleSettingsAction: get_workspace_settings ----

Deno.test("get_workspace_settings echoes context policy fields and maps account_category", async () => {
  const { client } = makeClient(() => ({ data: null, error: null }));
  const response = await handleSettingsAction(
    baseContext(client, {
      action: "get_workspace_settings",
      checkoutDueHours: 48,
      workspacePolicy: {
        checkout_due_hours: 48,
        account_category: "education",
        plan_code: "education",
        feature_flags: null,
      },
    }),
  );
  const body = await bodyOf(response);
  const data = body.data as Record<string, unknown>;

  assert(response.status === 200, "expected 200");
  assert(data.checkout_due_hours === 48, "expected checkout_due_hours to be echoed");
  assert(data.account_category === "education", "expected account_category to map through");
  assert(data.plan_code === "education", "expected plan_code to be echoed");
});

Deno.test("get_workspace_settings maps every known account_category and defaults unknown to null", async () => {
  const { client } = makeClient(() => ({ data: null, error: null }));
  const categories = ["individual", "education", "custom", "workspace", "bogus", null] as const;
  for (const category of categories) {
    const response = await handleSettingsAction(
      baseContext(client, {
        action: "get_workspace_settings",
        workspacePolicy: category === null
          ? null
          : {
            checkout_due_hours: 24,
            account_category: category as never,
            plan_code: null,
            feature_flags: null,
          },
      }),
    );
    const body = await bodyOf(response);
    const data = body.data as Record<string, unknown>;
    const expected = ["individual", "education", "custom", "workspace"].includes(category as string)
      ? category
      : null;
    assert(
      data.account_category === expected,
      `expected account_category ${expected} for input ${category}, got ${data.account_category}`,
    );
  }
});

// ---- handleSettingsAction: get_workspace_dashboard ----

const dashboardTables = {
  profiles: [{ id: "acct-1", auth_email: "a@example.com" }],
  items: [
    { id: "item-1", access_mode: "all", status: "checked_out", checked_out_at: "2000-01-01T00:00:00.000Z" },
    { id: "item-2", access_mode: "grant", status: "available", checked_out_at: null },
  ],
  borrowers: [{ id: "b-1", access_mode: "all" }],
  item_access_grants: [{ item_id: "item-2", profile_id: "acct-1" }],
  borrower_access_grants: [] as Array<{ borrower_id: string; profile_id: string }>,
  item_logs: [
    { item_id: "item-1", performed_by: "acct-1", action_type: "checkout", action_time: "2000-01-01T00:00:00.000Z" },
  ],
};

Deno.test("get_workspace_dashboard aggregates item/borrower/checkout counts per account", async () => {
  const { client } = makeClient((call) => {
    const rows = (dashboardTables as Record<string, unknown>)[call.table];
    return { data: rows ?? [], error: null };
  });
  const response = await handleSettingsAction(
    baseContext(client, { action: "get_workspace_dashboard", checkoutDueHours: 1 }),
  );
  const body = await bodyOf(response);
  const data = body.data as Array<Record<string, unknown>>;

  assert(response.status === 200, "expected 200");
  assert(data.length === 1, "expected one account row");
  const account = data[0];
  assert(account.profile_id === "acct-1", "expected the profile id to be echoed");
  assert(account.item_count === 2, `expected access to both items, got ${account.item_count}`);
  assert(account.borrower_count === 1, `expected access to the borrower, got ${account.borrower_count}`);
  assert(account.active_checkouts === 1, `expected 1 active checkout, got ${account.active_checkouts}`);
  assert(account.overdue_count === 1, `expected the checkout to be overdue, got ${account.overdue_count}`);
});

Deno.test("get_workspace_dashboard returns 400 when any parallel query errors", async () => {
  const { client } = makeClient((call) => {
    if (call.table === "borrowers") {
      return { data: null, error: { code: "500", message: "boom" } };
    }
    const rows = (dashboardTables as Record<string, unknown>)[call.table];
    return { data: rows ?? [], error: null };
  });
  const response = await handleSettingsAction(
    baseContext(client, { action: "get_workspace_dashboard" }),
  );

  assert(response.status === 400, "expected 400 on dashboard query error");
  assert(
    JSON.stringify(await bodyOf(response)) ===
      JSON.stringify({ error: "Unable to load workspace dashboard." }),
    "expected the dashboard error message",
  );
});

// ---- handleSettingsAction: update_workspace_settings (default branch) ----

Deno.test("update_workspace_settings upserts and returns normalized settings", async () => {
  const { client, calls } = makeClient((call) => {
    if (call.table === "workspace_policies") {
      return {
        data: {
          checkout_due_hours: 96,
          account_category: "workspace",
          plan_code: "workspace_growth",
          feature_flags: { enable_notifications: false },
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const response = await handleSettingsAction(
    baseContext(client, {
      action: "update_workspace_settings",
      payload: { checkout_due_hours: 96 },
    }),
  );
  const body = await bodyOf(response);
  const data = body.data as Record<string, unknown>;

  assert(response.status === 200, "expected 200 on successful update");
  assert(data.checkout_due_hours === 96, "expected updated checkout_due_hours");
  assert(data.account_category === "workspace", "expected account_category to map through");
  assert(
    (data.feature_flags as { enable_notifications: boolean }).enable_notifications === false,
    "expected normalized feature flags",
  );
  assert(
    calls.some((call) => call.operations.some((op) => op.method === "upsert")),
    "expected an upsert call against workspace_policies",
  );
});

Deno.test("update_workspace_settings throws a ValidationError for a non-numeric checkout_due_hours payload", async () => {
  const { client } = makeClient(() => ({ data: null, error: null }));
  let threw = false;
  try {
    await handleSettingsAction(
      baseContext(client, {
        action: "update_workspace_settings",
        payload: { checkout_due_hours: "not-a-number" },
      }),
    );
  } catch (error) {
    threw = true;
    assert(
      (error as Error).name === "ValidationError",
      `expected a ValidationError, got ${(error as Error).name}`,
    );
  }
  assert(threw, "expected an invalid checkout_due_hours to throw");
});

Deno.test("update_workspace_settings applies the default 24h checkout window when omitted", async () => {
  let capturedRow: Record<string, unknown> | null = null;
  const { client } = makeClient((call) => {
    if (call.table === "workspace_policies") {
      const upsertOp = call.operations.find((op) => op.method === "upsert");
      capturedRow = (upsertOp?.args[0] as Record<string, unknown>) ?? null;
      return {
        data: { checkout_due_hours: 24, account_category: null, plan_code: null, feature_flags: null },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  await handleSettingsAction(
    baseContext(client, { action: "update_workspace_settings", payload: {} }),
  );

  assert(capturedRow !== null, "expected an upsert to run");
  assert(
    (capturedRow as unknown as Record<string, unknown>).checkout_due_hours === 24,
    "expected the default 24h window when the payload omits it",
  );
});

Deno.test("update_workspace_settings retries without feature_flags when the column is missing", async () => {
  let upsertCalls = 0;
  const { client } = makeClient((call) => {
    if (call.table !== "workspace_policies") return { data: null, error: null };
    upsertCalls += 1;
    if (upsertCalls === 1) {
      return {
        data: null,
        error: { code: "42703", message: 'column "feature_flags" does not exist' },
      };
    }
    return {
      data: { checkout_due_hours: 24, account_category: "custom", plan_code: "custom" },
      error: null,
    };
  });
  const response = await handleSettingsAction(
    baseContext(client, {
      action: "update_workspace_settings",
      payload: { checkout_due_hours: 24 },
    }),
  );
  const body = await bodyOf(response);
  const data = body.data as Record<string, unknown>;

  assert(response.status === 200, "expected the fallback path to still succeed");
  assert(upsertCalls === 2, `expected two upsert attempts, got ${upsertCalls}`);
  assert(data.account_category === "custom", "expected the fallback data to be normalized");
  assert(
    (data.feature_flags as { enable_notifications: boolean }).enable_notifications === true,
    "expected default feature flags when the column is missing",
  );
});

Deno.test("update_workspace_settings returns 400 when the upsert fails", async () => {
  const { client } = makeClient(() => ({
    data: null,
    error: { code: "23505", message: "conflict" },
  }));
  const response = await handleSettingsAction(
    baseContext(client, {
      action: "update_workspace_settings",
      payload: { checkout_due_hours: 24 },
    }),
  );

  assert(response.status === 400, "expected 400 on upsert failure");
  assert(
    JSON.stringify(await bodyOf(response)) ===
      JSON.stringify({ error: "Unable to save tenant settings." }),
    "expected the save-failure error message",
  );
});

Deno.test("update_workspace_settings returns 400 when the upsert succeeds without data", async () => {
  const { client } = makeClient(() => ({ data: null, error: null }));
  const response = await handleSettingsAction(
    baseContext(client, {
      action: "update_workspace_settings",
      payload: { checkout_due_hours: 24 },
    }),
  );

  assert(response.status === 400, "expected 400 when no row comes back");
});
