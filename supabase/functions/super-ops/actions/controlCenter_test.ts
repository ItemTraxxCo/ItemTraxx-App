import { CONTROL_CENTER_ACTIONS, handleControlCenterAction } from "./controlCenter.ts";
import type { SuperOpsContext } from "../context.ts";

// --- hand-rolled assertion helpers (matches repo convention: no std/assert import) ---
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message?: string) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(message ?? `Expected ${b} but got ${a}`);
  }
};

const assertThrowsAsync = async (
  fn: () => Promise<unknown>,
  messageIncludes: string,
) => {
  try {
    await fn();
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(messageIncludes),
      `Expected error message to include "${messageIncludes}" but got "${
        (error as Error)?.message
      }"`,
    );
    return;
  }
  throw new Error(`Expected function to throw an error including "${messageIncludes}"`);
};

// --- mock Supabase admin client ---
type QueryCall = { table: string; operations: Array<{ method: string; args: unknown[] }> };
type QueryResult = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};

const buildFrom = (respond: (call: QueryCall) => QueryResult | Promise<QueryResult>) =>
(table: string) => {
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
      "order",
      "limit",
    ]
  ) {
    query[method] = (...args: unknown[]) => record(method, args);
  }
  const resolve = () => {
    const call = { table, operations: [...operations] };
    return Promise.resolve(respond(call));
  };
  query.single = () => {
    operations.push({ method: "single", args: [] });
    return resolve();
  };
  query.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => resolve().then(onFulfilled, onRejected);
  return query;
};

// Calls within a single action handler run strictly in series (never
// Promise.all except for get_control_center, whose four lookups are still
// registered - and therefore dispatched to our mock - in the literal array
// order the source code declares them in). A call-index based sequence of
// canned responses is therefore enough to steer every branch precisely.
const sequenceClient = (results: QueryResult[]) => {
  let index = 0;
  const respond = (_call: QueryCall): QueryResult => {
    const result = results[index] ?? { data: null, error: null };
    index += 1;
    return result;
  };
  return { from: buildFrom(respond) } as unknown as SuperOpsContext["adminClient"];
};

const OTHER_ERROR = { code: "53300", message: "too many connections" };
const MISSING_FEATURE_FLAGS_ERROR = {
  code: "42703",
  message: 'column "feature_flags" does not exist',
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const contextFor = (
  action: string,
  payload: Record<string, unknown>,
  adminClient: SuperOpsContext["adminClient"],
  overrides: Partial<SuperOpsContext> & { writeAudit?: SuperOpsContext["writeAudit"] } = {},
): SuperOpsContext => ({
  req: new Request("https://example.test/functions/v1/super-ops", { method: "POST" }),
  action,
  payload,
  adminClient,
  user: { id: "00000000-0000-4000-8000-000000000001", email: "admin@example.test" },
  profile: { auth_email: "admin@example.test" },
  accessToken: "test-access-token",
  supabaseUrl: "https://example.test",
  publishableKey: "test-publishable-key",
  jsonResponse,
  writeAudit: async () => {},
  ...overrides,
});

const responseBody = (response: Response) =>
  response.json() as Promise<Record<string, unknown>>;

const auditRecorder = () => {
  const calls: unknown[][] = [];
  const writeAudit: SuperOpsContext["writeAudit"] = async (...args) => {
    calls.push(args);
  };
  return { calls, writeAudit };
};

Deno.test("controlCenter registry owns exactly the 7 live actions", () => {
  assertEquals(CONTROL_CENTER_ACTIONS.length, 7);
  assertEquals(new Set(CONTROL_CENTER_ACTIONS).size, 7);
});

Deno.test("handleControlCenterAction returns null for actions it does not own", async () => {
  const adminClient = sequenceClient([]);
  const response = await handleControlCenterAction(contextFor("not_a_live_action", {}, adminClient));
  assertEquals(response, null);
});

// =====================================================================
// get_control_center
// =====================================================================

Deno.test("get_control_center assembles runtime config, alert rules, approvals, and jobs", async () => {
  const adminClient = sequenceClient([
    { data: [{ key: "maintenance_mode", value: false }, { key: "banner", value: "hi" }], error: null },
    { data: [{ id: "rule-1", name: "High errors", metric_key: "errors", threshold: 10, is_enabled: true, created_at: "t" }], error: null },
    { data: [], error: null },
    { data: [], error: null },
  ]);
  const response = await handleControlCenterAction(contextFor("get_control_center", {}, adminClient));

  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), {
    data: {
      runtime_config: { maintenance_mode: false, banner: "hi" },
      alert_rules: [{ id: "rule-1", name: "High errors", metric_key: "errors", threshold: 10, is_enabled: true, created_at: "t" }],
      approvals: [],
      jobs: [],
    },
  });
});

Deno.test("get_control_center reports a generic failure when any lookup errors", async () => {
  const adminClient = sequenceClient([
    { data: null, error: OTHER_ERROR },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  ]);
  const response = await handleControlCenterAction(contextFor("get_control_center", {}, adminClient));

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to load control center." });
});

// =====================================================================
// set_runtime_config
// =====================================================================

Deno.test("set_runtime_config requires a key", async () => {
  const adminClient = sequenceClient([]);
  await assertThrowsAsync(
    () => handleControlCenterAction(contextFor("set_runtime_config", { value: {} }, adminClient)) as Promise<unknown>,
    "Invalid request",
  );
});

Deno.test("set_runtime_config rejects a non-object value", async () => {
  const adminClient = sequenceClient([]);
  await assertThrowsAsync(
    () =>
      handleControlCenterAction(
        contextFor("set_runtime_config", { key: "maintenance_mode", value: [] }, adminClient),
      ) as Promise<unknown>,
    "Invalid request",
  );
});

Deno.test("set_runtime_config saves the config and records an audit entry", async () => {
  const { calls, writeAudit } = auditRecorder();
  const adminClient = sequenceClient([
    { data: { key: "maintenance_mode", value: { enabled: true } }, error: null },
  ]);
  const response = await handleControlCenterAction(
    contextFor(
      "set_runtime_config",
      { key: "maintenance_mode", value: { enabled: true } },
      adminClient,
      { writeAudit },
    ),
  );

  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), {
    data: { key: "maintenance_mode", value: { enabled: true } },
  });
  assertEquals(calls, [["set_runtime_config", "config", "maintenance_mode", { key: "maintenance_mode" }]]);
});

Deno.test("set_runtime_config reports a generic failure on error", async () => {
  const adminClient = sequenceClient([{ data: null, error: OTHER_ERROR }]);
  const response = await handleControlCenterAction(
    contextFor("set_runtime_config", { key: "maintenance_mode" }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to save runtime config." });
});

// =====================================================================
// upsert_alert_rule
// =====================================================================

Deno.test("upsert_alert_rule rejects a malformed id", async () => {
  const adminClient = sequenceClient([]);
  const response = await handleControlCenterAction(
    contextFor("upsert_alert_rule", {
      id: "not-a-uuid",
      name: "n",
      metric_key: "m",
      threshold: 1,
    }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Invalid request" });
});

Deno.test("upsert_alert_rule rejects a non-numeric threshold", async () => {
  const adminClient = sequenceClient([]);
  const response = await handleControlCenterAction(
    contextFor("upsert_alert_rule", {
      name: "n",
      metric_key: "m",
      threshold: "not-a-number",
    }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Invalid request" });
});

Deno.test("upsert_alert_rule creates a rule, defaults is_enabled true, and records an audit entry", async () => {
  const { calls, writeAudit } = auditRecorder();
  const adminClient = sequenceClient([
    { data: { id: "rule-1", name: "n", metric_key: "m", threshold: 5, is_enabled: true, created_at: "t" }, error: null },
  ]);
  const response = await handleControlCenterAction(
    contextFor("upsert_alert_rule", { name: "n", metric_key: "m", threshold: 5 }, adminClient, {
      writeAudit,
    }),
  );

  assertEquals(response!.status, 200);
  assertEquals(calls, [["upsert_alert_rule", "alert_rule", "rule-1", { metric_key: "m", threshold: 5 }]]);
});

Deno.test("upsert_alert_rule reports a generic failure on error", async () => {
  const adminClient = sequenceClient([{ data: null, error: OTHER_ERROR }]);
  const response = await handleControlCenterAction(
    contextFor("upsert_alert_rule", { name: "n", metric_key: "m", threshold: 5 }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to save alert rule." });
});

// =====================================================================
// set_workspace_policy
// =====================================================================

const VALID_WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";

Deno.test("set_workspace_policy requires a valid workspace id", async () => {
  const adminClient = sequenceClient([]);
  await assertThrowsAsync(
    () =>
      handleControlCenterAction(
        contextFor("set_workspace_policy", { workspace_id: "not-a-uuid" }, adminClient),
      ) as Promise<unknown>,
    "Invalid request",
  );
});

Deno.test("set_workspace_policy saves the policy and records an audit entry", async () => {
  const { calls, writeAudit } = auditRecorder();
  const savedRow = { workspace_id: VALID_WORKSPACE_ID, max_admins: 5, max_borrowers: 100, max_items: 100, checkout_due_hours: 72, barcode_pattern: null, feature_flags: {} };
  const adminClient = sequenceClient([{ data: savedRow, error: null }]);
  const response = await handleControlCenterAction(
    contextFor("set_workspace_policy", { workspace_id: VALID_WORKSPACE_ID }, adminClient, {
      writeAudit,
    }),
  );

  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), { data: savedRow });
  assertEquals(calls.length, 1);
  assertEquals(calls[0][0], "set_workspace_policy");
});

Deno.test("set_workspace_policy falls back when feature_flags/account_category/plan_code columns are missing", async () => {
  const { calls, writeAudit } = auditRecorder();
  const fallbackRow = { workspace_id: VALID_WORKSPACE_ID, max_admins: null, max_borrowers: null, max_items: null, checkout_due_hours: 72, barcode_pattern: null };
  const adminClient = sequenceClient([
    { data: null, error: MISSING_FEATURE_FLAGS_ERROR },
    { data: fallbackRow, error: null },
  ]);
  const response = await handleControlCenterAction(
    contextFor("set_workspace_policy", { workspace_id: VALID_WORKSPACE_ID }, adminClient, {
      writeAudit,
    }),
  );

  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), { data: fallbackRow });
  assertEquals(calls.length, 1);
});

Deno.test("set_workspace_policy reports a generic failure when the fallback also fails", async () => {
  const adminClient = sequenceClient([
    { data: null, error: MISSING_FEATURE_FLAGS_ERROR },
    { data: null, error: OTHER_ERROR },
  ]);
  const response = await handleControlCenterAction(
    contextFor("set_workspace_policy", { workspace_id: VALID_WORKSPACE_ID }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to save tenant policy." });
});

Deno.test("set_workspace_policy reports a generic failure for unrelated errors without retrying", async () => {
  const adminClient = sequenceClient([{ data: null, error: OTHER_ERROR }]);
  const response = await handleControlCenterAction(
    contextFor("set_workspace_policy", { workspace_id: VALID_WORKSPACE_ID }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to save tenant policy." });
});

// =====================================================================
// set_workspace_force_reauth
// =====================================================================

Deno.test("set_workspace_force_reauth requires a valid workspace id", async () => {
  const adminClient = sequenceClient([]);
  await assertThrowsAsync(
    () =>
      handleControlCenterAction(
        contextFor("set_workspace_force_reauth", { workspace_id: "bad" }, adminClient),
      ) as Promise<unknown>,
    "Invalid request",
  );
});

Deno.test("set_workspace_force_reauth reports a generic failure when the update errors", async () => {
  const adminClient = sequenceClient([{ data: null, error: OTHER_ERROR }]);
  const response = await handleControlCenterAction(
    contextFor("set_workspace_force_reauth", { workspace_id: VALID_WORKSPACE_ID }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to force tenant re-login." });
});

Deno.test("set_workspace_force_reauth succeeds, logs a job, and records an audit entry", async () => {
  const { calls, writeAudit } = auditRecorder();
  const adminClient = sequenceClient([
    { data: null, error: null },
    { data: { id: "job-1", job_type: "force_workspace_reauth", status: "completed", details: {}, created_at: "t", updated_at: "t" }, error: null },
  ]);
  const response = await handleControlCenterAction(
    contextFor("set_workspace_force_reauth", { workspace_id: VALID_WORKSPACE_ID }, adminClient, {
      writeAudit,
    }),
  );

  assertEquals(response!.status, 200);
  const body = await responseBody(response!);
  const data = body.data as { success: boolean; job: unknown };
  assertEquals(data.success, true);
  assert(!!data.job, "expected the created job to be returned");
  assertEquals(calls[0][0], "force_workspace_reauth");
  assertEquals(calls[0][1], "workspace");
  assertEquals(calls[0][2], VALID_WORKSPACE_ID);
});

// =====================================================================
// create_approval
// =====================================================================

Deno.test("create_approval requires an action type", async () => {
  const adminClient = sequenceClient([]);
  await assertThrowsAsync(
    () =>
      handleControlCenterAction(
        contextFor("create_approval", {}, adminClient),
      ) as Promise<unknown>,
    "Invalid request",
  );
});

Deno.test("create_approval succeeds and records an audit entry", async () => {
  const { calls, writeAudit } = auditRecorder();
  const adminClient = sequenceClient([
    { data: { id: "approval-1", action_type: "grant_admin", payload: {}, requested_by: "u1", status: "pending", created_at: "t" }, error: null },
  ]);
  const response = await handleControlCenterAction(
    contextFor("create_approval", { action_type: "grant_admin" }, adminClient, { writeAudit }),
  );

  assertEquals(response!.status, 200);
  assertEquals(calls, [["create_approval", "approval", "approval-1", { action_type: "grant_admin" }]]);
});

Deno.test("create_approval reports a generic failure on error", async () => {
  const adminClient = sequenceClient([{ data: null, error: OTHER_ERROR }]);
  const response = await handleControlCenterAction(
    contextFor("create_approval", { action_type: "grant_admin" }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to create approval request." });
});

// =====================================================================
// approve_request
// =====================================================================

const APPROVAL_ID = "20000000-0000-4000-8000-000000000001";

Deno.test("approve_request requires a valid id", async () => {
  const adminClient = sequenceClient([]);
  await assertThrowsAsync(
    () =>
      handleControlCenterAction(
        contextFor("approve_request", { id: "bad" }, adminClient),
      ) as Promise<unknown>,
    "Invalid request",
  );
});

Deno.test("approve_request reports not-found when the approval does not exist", async () => {
  const adminClient = sequenceClient([{ data: null, error: OTHER_ERROR }]);
  const response = await handleControlCenterAction(
    contextFor("approve_request", { id: APPROVAL_ID }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Approval request not found." });
});

Deno.test("approve_request refuses a requester approving their own request", async () => {
  const adminClient = sequenceClient([
    { data: { id: APPROVAL_ID, requested_by: "00000000-0000-4000-8000-000000000001", status: "pending" }, error: null },
  ]);
  const response = await handleControlCenterAction(
    contextFor("approve_request", { id: APPROVAL_ID }, adminClient),
  );

  assertEquals(response!.status, 403);
  assertEquals(await responseBody(response!), { error: "Requester cannot self-approve." });
});

Deno.test("approve_request refuses to re-decide an already-resolved request", async () => {
  const adminClient = sequenceClient([
    { data: { id: APPROVAL_ID, requested_by: "someone-else", status: "approved" }, error: null },
  ]);
  const response = await handleControlCenterAction(
    contextFor("approve_request", { id: APPROVAL_ID }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Approval request is already resolved." });
});

Deno.test("approve_request reports a generic failure when the update fails", async () => {
  const adminClient = sequenceClient([
    { data: { id: APPROVAL_ID, requested_by: "someone-else", status: "pending" }, error: null },
    { data: null, error: OTHER_ERROR },
  ]);
  const response = await handleControlCenterAction(
    contextFor("approve_request", { id: APPROVAL_ID }, adminClient),
  );

  assertEquals(response!.status, 400);
  assertEquals(await responseBody(response!), { error: "Unable to approve request." });
});

Deno.test("approve_request succeeds and records an audit entry", async () => {
  const { calls, writeAudit } = auditRecorder();
  const approved = { id: APPROVAL_ID, action_type: "grant_admin", payload: {}, requested_by: "someone-else", approved_by: "00000000-0000-4000-8000-000000000001", status: "approved", created_at: "t", decided_at: "t" };
  const adminClient = sequenceClient([
    { data: { id: APPROVAL_ID, requested_by: "someone-else", status: "pending" }, error: null },
    { data: approved, error: null },
  ]);
  const response = await handleControlCenterAction(
    contextFor("approve_request", { id: APPROVAL_ID }, adminClient, { writeAudit }),
  );

  assertEquals(response!.status, 200);
  assertEquals(await responseBody(response!), { data: approved });
  assertEquals(calls, [["approve_request", "approval", APPROVAL_ID, {}]]);
});
