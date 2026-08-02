import {
  handleInternalOpsAction,
  INTERNAL_OPS_ACTIONS,
} from "./internalOps.ts";
import type { SuperOpsContext } from "../context.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: status < 400, ...body }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

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
      "neq",
      "is",
      "in",
      "gte",
      "not",
      "or",
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

type TableConfig = Record<string, unknown> | Array<Record<string, unknown>>;

const buildAdminClient = (
  tables: Record<string, TableConfig>,
  invoke: (name: string) => Promise<unknown> = () =>
    Promise.resolve({ data: null, error: null }),
) => {
  const counters: Record<string, number> = {};
  const from = (table: string) => {
    const configured = tables[table] ?? { data: [], error: null };
    let result: Record<string, unknown>;
    if (Array.isArray(configured)) {
      const idx = counters[table] ?? 0;
      counters[table] = idx + 1;
      result = configured[Math.min(idx, configured.length - 1)];
    } else {
      result = configured as Record<string, unknown>;
    }
    return queryResult(result);
  };
  return {
    from,
    functions: { invoke },
  };
};

const contextFor = (
  action: string,
  payload: Record<string, unknown>,
  adminClient: unknown,
  writeAudit: SuperOpsContext["writeAudit"] = () => Promise.resolve(),
) => ({
  req: new Request("https://example.test/functions/v1/super-ops", {
    method: "POST",
  }),
  action,
  payload,
  adminClient,
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@example.test",
  },
  profile: { auth_email: "admin@example.test" },
  accessToken: "test-token",
  supabaseUrl: "https://example.test",
  publishableKey: "test-key",
  jsonResponse,
  writeAudit,
} as unknown as SuperOpsContext);

Deno.test("INTERNAL_OPS_ACTIONS exposes exactly one action", () => {
  assert(INTERNAL_OPS_ACTIONS.length === 1, "expected exactly one action");
  assert(
    INTERNAL_OPS_ACTIONS[0] === "get_internal_ops_snapshot",
    "expected get_internal_ops_snapshot",
  );
});

Deno.test("get_internal_ops_snapshot returns null for unrelated actions", async () => {
  const adminClient = buildAdminClient({});
  const response = await handleInternalOpsAction(
    contextFor("some_other_action", {}, adminClient),
  );
  assert(response === null, "expected null for unhandled action");
});

Deno.test("get_internal_ops_snapshot returns a full snapshot with traffic, queue, leads, and alerts", async () => {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  const workspaceId = "10000000-0000-4000-8000-000000000001";
  const itemId = "20000000-0000-4000-8000-000000000001";
  const borrowerId = "30000000-0000-4000-8000-000000000001";

  const itemLogs = [
    {
      workspace_id: workspaceId,
      item_id: itemId,
      checked_out_by: borrowerId,
      action_type: "checkout",
      action_time: iso(5 * 60 * 1000),
    },
    {
      workspace_id: workspaceId,
      item_id: itemId,
      checked_out_by: borrowerId,
      action_type: "return",
      action_time: iso(6 * 60 * 1000),
    },
    {
      workspace_id: workspaceId,
      item_id: itemId,
      checked_out_by: borrowerId,
      action_type: "checkout",
      action_time: iso(60 * 60 * 1000),
    },
  ];

  const asyncJobs: Array<{ status: string; created_at: string }> = [
    { status: "failed", created_at: iso(60 * 1000) },
    { status: "completed", created_at: iso(60 * 1000) },
  ];
  for (let i = 0; i < 15; i++) {
    asyncJobs.push({ status: "queued", created_at: iso(60 * 1000) });
  }

  const staleLeadCreated = iso(72 * 60 * 60 * 1000);
  const leads = [
    {
      id: "40000000-0000-4000-8000-000000000001",
      lead_state: "open",
      stage: "waiting_for_quote",
      created_at: staleLeadCreated,
    },
    {
      id: "40000000-0000-4000-8000-000000000002",
      lead_state: "closed",
      stage: "quote_sent",
      created_at: iso(1000),
    },
    {
      id: "40000000-0000-4000-8000-000000000003",
      lead_state: "converted_to_customer",
      stage: "invoice_paid",
      created_at: iso(1000),
    },
  ];

  const runtimeConfigRows = [
    { key: "maintenance_mode", value: false },
    { key: "broadcast_message", value: null },
  ];

  const auditRows = [
    {
      id: "a1",
      actor_email: "admin@example.test",
      action_type: "close_sales_lead",
      target_type: "sales_lead",
      target_id: "40000000-0000-4000-8000-000000000002",
      metadata: { duration_ms: 120 },
      created_at: iso(1000),
    },
    {
      id: "a2",
      actor_email: "admin@example.test",
      action_type: "update_support_request",
      target_type: "support_request",
      target_id: null,
      metadata: { duration_ms: 80 },
      created_at: iso(2000),
    },
  ];

  const customerLeadId = "40000000-0000-4000-8000-000000000003";
  const customerLeads = [
    {
      id: customerLeadId,
      lead_state: "converted_to_customer",
      created_at: iso(1000),
      updated_at: iso(500),
    },
  ];

  const statusLogs = [
    { lead_id: customerLeadId, status: "awaiting_payment", created_at: iso(200) },
  ];

  const workspaceRows = [{ id: workspaceId, name: "Lincoln Elementary" }];
  const itemRows = [{ id: itemId, name: "Chromebook 12", barcode: "CB-0012" }];
  const borrowerRows = [
    { id: borrowerId, username: "jdoe", borrower_id: "1234AB" },
  ];
  const allWorkspaces = [
    { id: workspaceId, name: "Lincoln Elementary", status: "active" },
  ];

  const adminClient = buildAdminClient(
    {
      item_logs: { data: itemLogs, error: null },
      async_jobs: { data: asyncJobs, error: null },
      sales_leads: [
        { data: leads, error: null },
        { data: customerLeads, error: null },
      ],
      app_runtime_config: { data: runtimeConfigRows, error: null },
      super_admin_audit_logs: { data: auditRows, error: null },
      workspaces: [
        { data: workspaceRows, error: null },
        { data: allWorkspaces, error: null },
      ],
      items: { data: itemRows, error: null },
      borrowers: { data: borrowerRows, error: null },
      customer_status_logs: { data: statusLogs, error: null },
    },
    () => Promise.resolve({ data: { duration_ms: 55 }, error: null }),
  );

  const response = await handleInternalOpsAction(
    contextFor("get_internal_ops_snapshot", {}, adminClient),
  );
  assert(response !== null, "expected a response");
  assert(response!.status === 200, `expected 200, got ${response!.status}`);
  const body = await response!.json() as Record<string, unknown>;
  assert(body.ok === true, "expected ok true");
  const data = body.data as Record<string, any>;

  assert(data.traffic.checkout_15m === 1, `checkout_15m ${data.traffic.checkout_15m}`);
  assert(data.traffic.return_15m === 1, `return_15m ${data.traffic.return_15m}`);
  assert(data.traffic.active_workspaces_15m === 1, "active workspaces");
  assert(data.traffic.events_24h === 3, "events_24h");
  assert(data.queue.failed === 1, "queue failed");
  assert(data.queue.queued === 15, `queue queued ${data.queue.queued}`);
  assert(
    data.leads.open === 1 && data.leads.closed === 1 && data.leads.converted === 1,
    "lead summary",
  );
  assert(data.lead_funnel.invoice_paid === 1, "lead funnel invoice paid");
  assert(data.sla.probe_latency_ms === 55, "probe latency");
  assert(data.sla.error_rate_percent > 0, "error rate percent");
  const attentionKeys = data.needs_attention.map((entry: any) => entry.key);
  assert(attentionKeys.includes("failed_jobs"), "failed jobs alert");
  assert(attentionKeys.includes("queue_backlog"), "queue backlog alert");
  assert(attentionKeys.includes("stale_open_leads"), "stale leads alert");
  assert(attentionKeys.includes("customer_billing_risk"), "billing risk alert");
  assert(data.customer_health.total_customers === 1, "customer total");
  assert(data.customer_health.awaiting_payment === 1, "awaiting payment");
  assert(data.recent_audit.length === 2, "audit length");
  assert(
    data.search_index.some((e: any) => e.id === `tenant_${workspaceId}`),
    "search index tenant",
  );
  assert(data.runtime.maintenance_mode === false, "runtime config");
  assert(data.recent_events.length === 3, "recent events length");
  assert(data.recent_events[0].item_name === "Chromebook 12", "item name resolved");
  assert(data.recent_events[0].borrower_username === "jdoe", "borrower resolved");
  assert(
    data.recent_events[0].workspace_name === "Lincoln Elementary",
    "workspace resolved",
  );
});

Deno.test("get_internal_ops_snapshot falls back to Unknown workspace and nulls for unmapped events", async () => {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();
  const itemLogs = [
    {
      workspace_id: "10000000-0000-4000-8000-000000000099",
      item_id: "20000000-0000-4000-8000-000000000099",
      checked_out_by: "30000000-0000-4000-8000-000000000099",
      action_type: "checkout",
      action_time: iso(1000),
    },
  ];

  const adminClient = buildAdminClient({
    item_logs: { data: itemLogs, error: null },
    async_jobs: { data: [], error: null },
    sales_leads: [{ data: [], error: null }, { data: [], error: null }],
    app_runtime_config: { data: [], error: null },
    super_admin_audit_logs: { data: [], error: null },
    workspaces: [{ data: [], error: null }, { data: [], error: null }],
    items: { data: [], error: null },
    borrowers: { data: [], error: null },
  });

  const response = await handleInternalOpsAction(
    contextFor("get_internal_ops_snapshot", {}, adminClient),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  const event = body.data.recent_events[0];
  assert(event.workspace_name === "Unknown workspace", "unknown workspace fallback");
  assert(event.item_name === null, "item name null fallback");
  assert(event.borrower_username === null, "borrower null fallback");
});

Deno.test("get_internal_ops_snapshot rejects when recent traffic logs fail to load", async () => {
  const adminClient = buildAdminClient({
    item_logs: { data: null, error: { message: "db down" } },
  });
  const response = await handleInternalOpsAction(
    contextFor("get_internal_ops_snapshot", {}, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(body.error === "Unable to load recent traffic logs.", "expected traffic error");
});

Deno.test("get_internal_ops_snapshot rejects when async jobs fail to load", async () => {
  const adminClient = buildAdminClient({
    async_jobs: { data: null, error: { message: "db down" } },
  });
  const response = await handleInternalOpsAction(
    contextFor("get_internal_ops_snapshot", {}, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(body.error === "Unable to load async jobs.", "expected async jobs error");
});

Deno.test("get_internal_ops_snapshot rejects when lead metrics fail to load", async () => {
  const adminClient = buildAdminClient({
    sales_leads: [{ data: null, error: { message: "db down" } }],
  });
  const response = await handleInternalOpsAction(
    contextFor("get_internal_ops_snapshot", {}, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(body.error === "Unable to load lead metrics.", "expected lead metrics error");
});

Deno.test("get_internal_ops_snapshot rejects when the audit feed fails to load", async () => {
  const adminClient = buildAdminClient({
    super_admin_audit_logs: { data: null, error: { message: "db down" } },
  });
  const response = await handleInternalOpsAction(
    contextFor("get_internal_ops_snapshot", {}, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(body.error === "Unable to load audit feed.", "expected audit feed error");
});

Deno.test("get_internal_ops_snapshot rejects when customer health leads fail to load", async () => {
  const adminClient = buildAdminClient({
    sales_leads: [
      { data: [], error: null },
      { data: null, error: { message: "db down" } },
    ],
  });
  const response = await handleInternalOpsAction(
    contextFor("get_internal_ops_snapshot", {}, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Unable to load customer health metrics.",
    "expected customer health error",
  );
});

Deno.test("get_internal_ops_snapshot rejects when customer status logs fail to load", async () => {
  const customerLeadId = "40000000-0000-4000-8000-000000000009";
  const adminClient = buildAdminClient({
    sales_leads: [
      { data: [], error: null },
      {
        data: [{
          id: customerLeadId,
          lead_state: "converted_to_customer",
          created_at: new Date().toISOString(),
          updated_at: null,
        }],
        error: null,
      },
    ],
    customer_status_logs: { data: null, error: { message: "db down" } },
  });
  const response = await handleInternalOpsAction(
    contextFor("get_internal_ops_snapshot", {}, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Unable to load customer status metrics.",
    "expected customer status error",
  );
});

Deno.test("get_internal_ops_snapshot tolerates the status probe throwing", async () => {
  const adminClient = buildAdminClient({}, () => {
    throw new Error("probe unreachable");
  });
  const response = await handleInternalOpsAction(
    contextFor("get_internal_ops_snapshot", {}, adminClient),
  );
  assert(response!.status === 200, "expected 200 even when probe throws");
  const body = await response!.json() as Record<string, any>;
  assert(body.data.sla.probe_latency_ms === null, "expected null probe latency");
});

Deno.test("get_internal_ops_snapshot ignores a non-numeric probe duration", async () => {
  const adminClient = buildAdminClient(
    {},
    () => Promise.resolve({ data: { duration_ms: "not-a-number" }, error: null }),
  );
  const response = await handleInternalOpsAction(
    contextFor("get_internal_ops_snapshot", {}, adminClient),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.data.sla.probe_latency_ms === null, "expected null probe latency");
});
