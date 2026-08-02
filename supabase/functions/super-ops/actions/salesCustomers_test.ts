import {
  handleSalesCustomersAction,
  SALES_CUSTOMER_ACTIONS,
} from "./salesCustomers.ts";
import type { SuperOpsContext } from "../context.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertThrows = async (fn: () => Promise<unknown>, message: string) => {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
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

const buildAdminClient = (tables: Record<string, TableConfig>) => {
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
  return { from };
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

const LEAD_ID = "40000000-0000-4000-8000-000000000001";

Deno.test("SALES_CUSTOMER_ACTIONS exposes exactly seven actions", () => {
  assert(SALES_CUSTOMER_ACTIONS.length === 7, "expected 7 actions");
});

Deno.test("handleSalesCustomersAction returns null for unrelated actions", async () => {
  const response = await handleSalesCustomersAction(
    contextFor("some_other_action", {}, buildAdminClient({})),
  );
  assert(response === null, "expected null for unhandled action");
});

// ── list_sales_leads ────────────────────────────────────────────────────────

Deno.test("list_sales_leads rejects search text with disallowed characters", async () => {
  await assertThrows(
    () =>
      handleSalesCustomersAction(
        contextFor(
          "list_sales_leads",
          { search: "abc*def" },
          buildAdminClient({}),
        ),
      ),
    "expected search validation to throw",
  );
});

Deno.test("list_sales_leads rejects a non-numeric limit", async () => {
  await assertThrows(
    () =>
      handleSalesCustomersAction(
        contextFor(
          "list_sales_leads",
          { limit: "lots" },
          buildAdminClient({}),
        ),
      ),
    "expected limit validation to throw",
  );
});

Deno.test("list_sales_leads returns leads on success", async () => {
  const leads = [{ id: LEAD_ID, lead_state: "open" }];
  const adminClient = buildAdminClient({
    sales_leads: { data: leads, error: null },
  });
  const response = await handleSalesCustomersAction(
    contextFor("list_sales_leads", { search: "Lincoln" }, adminClient),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.data.leads.length === 1, "expected one lead");
});

Deno.test("list_sales_leads surfaces a database error", async () => {
  const adminClient = buildAdminClient({
    sales_leads: { data: null, error: { message: "db down" } },
  });
  const response = await handleSalesCustomersAction(
    contextFor("list_sales_leads", {}, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(body.error === "Unable to load sales leads.", "expected leads error");
});

// ── close_sales_lead ─────────────────────────────────────────────────────────

Deno.test("close_sales_lead rejects an invalid lead id", async () => {
  await assertThrows(
    () =>
      handleSalesCustomersAction(
        contextFor(
          "close_sales_lead",
          { lead_id: "not-a-uuid" },
          buildAdminClient({}),
        ),
      ),
    "expected lead id validation to throw",
  );
});

Deno.test("close_sales_lead closes a lead and records an audit entry", async () => {
  const lead = { id: LEAD_ID, lead_state: "closed" };
  const auditCalls: unknown[][] = [];
  const adminClient = buildAdminClient({
    sales_leads: { data: lead, error: null },
  });
  const response = await handleSalesCustomersAction(
    contextFor(
      "close_sales_lead",
      { lead_id: LEAD_ID },
      adminClient,
      (...args) => {
        auditCalls.push(args);
        return Promise.resolve();
      },
    ),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.data.lead.id === LEAD_ID, "expected lead in response");
  assert(auditCalls.length === 1, "expected an audit call");
  assert(
    JSON.stringify(auditCalls[0]) ===
      JSON.stringify(["close_sales_lead", "sales_lead", LEAD_ID, {}]),
    "expected matching audit args",
  );
});

Deno.test("close_sales_lead surfaces a database error", async () => {
  const adminClient = buildAdminClient({
    sales_leads: { data: null, error: { message: "db down" } },
  });
  const response = await handleSalesCustomersAction(
    contextFor("close_sales_lead", { lead_id: LEAD_ID }, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(body.error === "Unable to close sales lead.", "expected close error");
});

// ── move_sales_lead_to_customer ──────────────────────────────────────────────

Deno.test("move_sales_lead_to_customer converts a lead on success", async () => {
  const lead = { id: LEAD_ID, lead_state: "converted_to_customer" };
  const adminClient = buildAdminClient({
    sales_leads: { data: lead, error: null },
  });
  const response = await handleSalesCustomersAction(
    contextFor(
      "move_sales_lead_to_customer",
      { lead_id: LEAD_ID },
      adminClient,
    ),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(
    body.data.lead.lead_state === "converted_to_customer",
    "expected converted lead",
  );
});

Deno.test("move_sales_lead_to_customer surfaces a database error", async () => {
  const adminClient = buildAdminClient({
    sales_leads: { data: null, error: { message: "db down" } },
  });
  const response = await handleSalesCustomersAction(
    contextFor(
      "move_sales_lead_to_customer",
      { lead_id: LEAD_ID },
      adminClient,
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Unable to move lead to customers.",
    "expected move error",
  );
});

// ── set_sales_lead_stage ─────────────────────────────────────────────────────

Deno.test("set_sales_lead_stage rejects an invalid lead id", async () => {
  await assertThrows(
    () =>
      handleSalesCustomersAction(
        contextFor(
          "set_sales_lead_stage",
          { lead_id: "not-a-uuid", stage: "quote_sent" },
          buildAdminClient({}),
        ),
      ),
    "expected lead id validation to throw",
  );
});

Deno.test("set_sales_lead_stage rejects a missing stage", async () => {
  const response = await handleSalesCustomersAction(
    contextFor(
      "set_sales_lead_stage",
      { lead_id: LEAD_ID },
      buildAdminClient({}),
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(body.error === "Invalid request", "expected invalid request error");
});

Deno.test("set_sales_lead_stage rejects an unrecognized stage", async () => {
  const response = await handleSalesCustomersAction(
    contextFor(
      "set_sales_lead_stage",
      { lead_id: LEAD_ID, stage: "not_a_real_stage" },
      buildAdminClient({}),
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(body.error === "Invalid request", "expected invalid request error");
});

Deno.test("set_sales_lead_stage updates the stage and records an audit entry", async () => {
  const lead = { id: LEAD_ID, stage: "quote_sent" };
  const auditCalls: unknown[][] = [];
  const adminClient = buildAdminClient({
    sales_leads: { data: lead, error: null },
  });
  const response = await handleSalesCustomersAction(
    contextFor(
      "set_sales_lead_stage",
      { lead_id: LEAD_ID, stage: "quote_sent" },
      adminClient,
      (...args) => {
        auditCalls.push(args);
        return Promise.resolve();
      },
    ),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.data.lead.stage === "quote_sent", "expected updated stage");
  assert(
    JSON.stringify(auditCalls[0]) ===
      JSON.stringify([
        "set_sales_lead_stage",
        "sales_lead",
        LEAD_ID,
        { stage: "quote_sent" },
      ]),
    "expected matching audit args",
  );
});

Deno.test("set_sales_lead_stage surfaces a database error", async () => {
  const adminClient = buildAdminClient({
    sales_leads: { data: null, error: { message: "db down" } },
  });
  const response = await handleSalesCustomersAction(
    contextFor(
      "set_sales_lead_stage",
      { lead_id: LEAD_ID, stage: "quote_sent" },
      adminClient,
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Unable to update lead stage.",
    "expected stage update error",
  );
});

// ── delete_sales_lead ────────────────────────────────────────────────────────

Deno.test("delete_sales_lead rejects an invalid lead id", async () => {
  await assertThrows(
    () =>
      handleSalesCustomersAction(
        contextFor(
          "delete_sales_lead",
          { lead_id: "not-a-uuid" },
          buildAdminClient({}),
        ),
      ),
    "expected lead id validation to throw",
  );
});

Deno.test("delete_sales_lead deletes a lead and records an audit entry", async () => {
  const auditCalls: unknown[][] = [];
  const adminClient = buildAdminClient({
    sales_leads: { data: null, error: null },
  });
  const response = await handleSalesCustomersAction(
    contextFor(
      "delete_sales_lead",
      { lead_id: LEAD_ID },
      adminClient,
      (...args) => {
        auditCalls.push(args);
        return Promise.resolve();
      },
    ),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.data.deleted === true, "expected deleted true");
  assert(auditCalls.length === 1, "expected an audit call");
});

Deno.test("delete_sales_lead surfaces a database error", async () => {
  const adminClient = buildAdminClient({
    sales_leads: { data: null, error: { message: "db down" } },
  });
  const response = await handleSalesCustomersAction(
    contextFor("delete_sales_lead", { lead_id: LEAD_ID }, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Unable to delete sales lead.",
    "expected delete error",
  );
});

// ── list_customers ───────────────────────────────────────────────────────────

Deno.test("list_customers rejects search text with disallowed characters", async () => {
  await assertThrows(
    () =>
      handleSalesCustomersAction(
        contextFor(
          "list_customers",
          { search: "abc(def)" },
          buildAdminClient({}),
        ),
      ),
    "expected search validation to throw",
  );
});

Deno.test("list_customers surfaces a lead-load database error", async () => {
  const adminClient = buildAdminClient({
    sales_leads: { data: null, error: { message: "db down" } },
  });
  const response = await handleSalesCustomersAction(
    contextFor("list_customers", {}, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(body.error === "Unable to load customers.", "expected customers error");
});

Deno.test("list_customers skips the status-log query when there are no leads", async () => {
  const adminClient = buildAdminClient({
    sales_leads: { data: [], error: null },
  });
  const response = await handleSalesCustomersAction(
    contextFor("list_customers", {}, adminClient),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.data.customers.length === 0, "expected no customers");
});

Deno.test("list_customers groups status logs by lead and surfaces the latest status", async () => {
  const leads = [
    { id: LEAD_ID, name: "Lincoln Elementary", organization: "District 5" },
  ];
  const statusLogs = [
    {
      id: "s1",
      lead_id: LEAD_ID,
      invoice_id: "inv-2",
      status: "paid_on_time",
      created_at: "2026-08-01T00:00:00.000Z",
      created_by: null,
    },
    {
      id: "s2",
      lead_id: LEAD_ID,
      invoice_id: "inv-1",
      status: "awaiting_payment",
      created_at: "2026-07-01T00:00:00.000Z",
      created_by: null,
    },
  ];
  const adminClient = buildAdminClient({
    sales_leads: { data: leads, error: null },
    customer_status_logs: { data: statusLogs, error: null },
  });
  const response = await handleSalesCustomersAction(
    contextFor("list_customers", {}, adminClient),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  const customer = body.data.customers[0];
  assert(customer.latest_status === "paid_on_time", "expected latest status first");
  assert(customer.latest_invoice_id === "inv-2", "expected latest invoice id");
  assert(customer.status_logs.length === 2, "expected both logs grouped");
});

Deno.test("list_customers surfaces a status-log database error", async () => {
  const leads = [{ id: LEAD_ID, name: "Lincoln Elementary" }];
  const adminClient = buildAdminClient({
    sales_leads: { data: leads, error: null },
    customer_status_logs: { data: null, error: { message: "db down" } },
  });
  const response = await handleSalesCustomersAction(
    contextFor("list_customers", {}, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Unable to load customer status logs.",
    "expected status log error",
  );
});

// ── add_customer_status_entry ───────────────────────────────────────────────

Deno.test("add_customer_status_entry rejects an invalid lead id", async () => {
  await assertThrows(
    () =>
      handleSalesCustomersAction(
        contextFor(
          "add_customer_status_entry",
          { lead_id: "not-a-uuid", invoice_id: "inv-1", status: "paid_on_time" },
          buildAdminClient({}),
        ),
      ),
    "expected lead id validation to throw",
  );
});

Deno.test("add_customer_status_entry rejects a missing invoice id", async () => {
  await assertThrows(
    () =>
      handleSalesCustomersAction(
        contextFor(
          "add_customer_status_entry",
          { lead_id: LEAD_ID, status: "paid_on_time" },
          buildAdminClient({}),
        ),
      ),
    "expected invoice id validation to throw",
  );
});

Deno.test("add_customer_status_entry rejects an unrecognized status", async () => {
  const response = await handleSalesCustomersAction(
    contextFor(
      "add_customer_status_entry",
      { lead_id: LEAD_ID, invoice_id: "inv-1", status: "not_a_real_status" },
      buildAdminClient({}),
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(body.error === "Invalid request", "expected invalid request error");
});

Deno.test("add_customer_status_entry inserts an entry using the acting user id", async () => {
  let insertedPayload: Record<string, unknown> | null = null;
  const query: Record<string, unknown> = {};
  query.insert = (payload: Record<string, unknown>) => {
    insertedPayload = payload;
    return query;
  };
  for (const method of ["select"]) {
    query[method] = () => query;
  }
  const entry = {
    id: "e1",
    lead_id: LEAD_ID,
    invoice_id: "inv-1",
    status: "paid_on_time",
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: "00000000-0000-4000-8000-000000000001",
  };
  query.select = () => query;
  query.insert = (payload: Record<string, unknown>) => {
    insertedPayload = payload;
    return query;
  };
  query.single = () => Promise.resolve({ data: entry, error: null });

  const adminClient = { from: () => query };
  const auditCalls: unknown[][] = [];
  const response = await handleSalesCustomersAction(
    contextFor(
      "add_customer_status_entry",
      { lead_id: LEAD_ID, invoice_id: "inv-1", status: "paid_on_time" },
      adminClient,
      (...args) => {
        auditCalls.push(args);
        return Promise.resolve();
      },
    ),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.data.entry.id === "e1", "expected entry in response");
  assert(insertedPayload !== null, "expected an insert payload");
  assert(
    (insertedPayload as any).created_by === "00000000-0000-4000-8000-000000000001",
    "expected created_by to be the acting user id",
  );
  assert(
    JSON.stringify(auditCalls[0]) ===
      JSON.stringify([
        "add_customer_status_entry",
        "sales_lead",
        LEAD_ID,
        { invoice_id: "inv-1", status: "paid_on_time" },
      ]),
    "expected matching audit args",
  );
});

Deno.test("add_customer_status_entry surfaces a database error", async () => {
  const adminClient = buildAdminClient({
    customer_status_logs: { data: null, error: { message: "db down" } },
  });
  const response = await handleSalesCustomersAction(
    contextFor(
      "add_customer_status_entry",
      { lead_id: LEAD_ID, invoice_id: "inv-1", status: "paid_on_time" },
      adminClient,
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Unable to add customer status entry.",
    "expected insert error",
  );
});
