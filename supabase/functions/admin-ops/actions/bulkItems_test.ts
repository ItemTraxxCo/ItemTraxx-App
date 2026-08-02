import { handleBulkItemsAction } from "./bulkItems.ts";
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
  payload: Record<string, unknown> = {},
): AdminOpsContext => ({
  requestId: "request-1",
  action: "bulk_import_items",
  payload,
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
  featureFlags: {
    enable_notifications: true,
    enable_bulk_item_import: true,
    enable_bulk_borrower_tools: true,
    enable_status_tracking: true,
    enable_barcode_generator: true,
  },
  maintenance: { enabled: false, message: "" },
  workspaceUpdates: [],
  jsonResponse: (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
});

const bodyOf = (response: Response) =>
  response.json() as Promise<Record<string, unknown>>;

Deno.test("bulk_import_items rejects an empty rows array", async () => {
  const { client, calls } = makeClient(() => ({ data: null, error: null }));
  const response = await handleBulkItemsAction(
    baseContext(client, { rows: [] }),
  );

  assert(response.status === 400, "expected 400 for empty rows");
  assert(
    JSON.stringify(await bodyOf(response)) ===
      JSON.stringify({ error: "Provide between 1 and 1000 rows." }),
    "expected the row-count error message",
  );
  assert(calls.length === 0, "no db calls should happen for empty rows");
});

Deno.test("bulk_import_items rejects a payload with no rows field", async () => {
  const { client } = makeClient(() => ({ data: null, error: null }));
  const response = await handleBulkItemsAction(baseContext(client, {}));

  assert(response.status === 400, "expected 400 when rows is missing");
});

Deno.test("bulk_import_items rejects more than 1000 rows without querying the db", async () => {
  const { client, calls } = makeClient(() => ({ data: null, error: null }));
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    name: `Item ${index}`,
    barcode: `ITEM-${index}`,
  }));
  const response = await handleBulkItemsAction(baseContext(client, { rows }));

  assert(response.status === 400, "expected 400 for over-limit rows");
  assert(calls.length === 0, "no db calls should happen for over-limit rows");
});

Deno.test("bulk_import_items skips non-object rows with an '(invalid)' marker", async () => {
  const { client } = makeClient((call) => {
    if (call.table === "items" && call.operations.some((op) => op.method === "in")) {
      return { data: [], error: null };
    }
    if (call.table === "items" && call.operations.some((op) => op.method === "insert")) {
      return {
        data: [{
          id: "item-1",
          workspace_id: "00000000-0000-4000-8000-000000000002",
          name: "Item A",
          barcode: "ITEM-A",
          serial_number: null,
          status: "available",
          notes: null,
        }],
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const response = await handleBulkItemsAction(
    baseContext(client, {
      rows: [null, "not-an-object", 42, { name: "Item A", barcode: "ITEM-A" }],
    }),
  );
  const body = await bodyOf(response);

  assert(response.status === 200, "expected 200 for a mixed batch");
  const data = body.data as { inserted: number; skipped: number; skipped_rows: unknown[] };
  assert(data.inserted === 1, `expected 1 inserted, got ${data.inserted}`);
  assert(data.skipped === 3, `expected 3 skipped, got ${data.skipped}`);
  assert(
    data.skipped_rows.every((row) =>
      (row as { barcode: string }).barcode === "(invalid)"
    ),
    "expected all invalid rows to carry the (invalid) marker",
  );
});

Deno.test("bulk_import_items marks rows failing validation as skipped with '(blank)' barcode", async () => {
  const { client, calls } = makeClient(() => ({ data: null, error: null }));
  const response = await handleBulkItemsAction(
    baseContext(client, { rows: [{ barcode: "ITEM-1" }] }),
  );
  const body = await bodyOf(response);

  assert(response.status === 200, "expected 200 even when every row is invalid");
  const data = body.data as {
    inserted: number;
    skipped: number;
    skipped_rows: Array<{ barcode: string; reason: string }>;
  };
  assert(data.inserted === 0, "expected nothing inserted");
  assert(data.skipped === 1, "expected one skipped row");
  assert(data.skipped_rows[0].barcode === "(blank)", "expected (blank) barcode marker");
  assert(data.skipped_rows[0].reason === "Invalid row.", "expected Invalid row reason");
  assert(calls.length === 0, "no db calls should happen when nothing normalizes");
});

Deno.test("bulk_import_items reports the actual barcode when a later field fails validation", async () => {
  const { client } = makeClient(() => ({ data: null, error: null }));
  const response = await handleBulkItemsAction(
    baseContext(client, {
      rows: [{ name: "Item A", barcode: "ITEM-A", status: "not_a_status" }],
    }),
  );
  const body = await bodyOf(response);
  const data = body.data as { skipped_rows: Array<{ barcode: string; reason: string }> };

  assert(data.skipped_rows[0].barcode === "ITEM-A", "expected the real barcode to be echoed");
  assert(data.skipped_rows[0].reason === "Invalid row.", "expected Invalid row reason");
});

Deno.test("bulk_import_items flags case-insensitive duplicate barcodes within the same import", async () => {
  const { client } = makeClient((call) => {
    if (call.table === "items" && call.operations.some((op) => op.method === "in")) {
      return { data: [], error: null };
    }
    if (call.table === "items" && call.operations.some((op) => op.method === "insert")) {
      return {
        data: [{
          id: "item-1",
          workspace_id: "00000000-0000-4000-8000-000000000002",
          name: "Item A",
          barcode: "ITEM-1",
          serial_number: null,
          status: "available",
          notes: null,
        }],
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const response = await handleBulkItemsAction(
    baseContext(client, {
      rows: [
        { name: "Item A", barcode: "ITEM-1" },
        { name: "Item A dup", barcode: "item-1" },
      ],
    }),
  );
  const body = await bodyOf(response);
  const data = body.data as {
    inserted: number;
    skipped: number;
    skipped_rows: Array<{ barcode: string; reason: string }>;
  };

  assert(data.inserted === 1, "expected only the first occurrence inserted");
  assert(data.skipped === 1, "expected the duplicate to be skipped");
  assert(
    data.skipped_rows[0].reason === "Duplicate barcode in import.",
    "expected duplicate-barcode reason",
  );
});

Deno.test("bulk_import_items skips rows whose barcode already exists in the workspace", async () => {
  const { client, calls } = makeClient((call) => {
    if (call.table === "items" && call.operations.some((op) => op.method === "in")) {
      return { data: [{ barcode: "ITEM-1" }], error: null };
    }
    return { data: null, error: null };
  });
  const response = await handleBulkItemsAction(
    baseContext(client, { rows: [{ name: "Item A", barcode: "ITEM-1" }] }),
  );
  const body = await bodyOf(response);
  const data = body.data as {
    inserted: number;
    skipped: number;
    skipped_rows: Array<{ barcode: string; reason: string }>;
  };

  assert(data.inserted === 0, "expected nothing inserted for an existing barcode");
  assert(data.skipped === 1, "expected the row to be skipped");
  assert(
    data.skipped_rows[0].reason === "Barcode already exists.",
    "expected the already-exists reason",
  );
  assert(
    calls.filter((call) => call.operations.some((op) => op.method === "insert")).length === 0,
    "insert should never be attempted when every row already exists",
  );
});

Deno.test("bulk_import_items returns 400 when the insert fails", async () => {
  const { client } = makeClient((call) => {
    if (call.table === "items" && call.operations.some((op) => op.method === "in")) {
      return { data: [], error: null };
    }
    if (call.table === "items" && call.operations.some((op) => op.method === "insert")) {
      return { data: null, error: { code: "23505", message: "duplicate key" } };
    }
    return { data: null, error: null };
  });
  const response = await handleBulkItemsAction(
    baseContext(client, { rows: [{ name: "Item A", barcode: "ITEM-1" }] }),
  );

  assert(response.status === 400, "expected 400 on insert failure");
  assert(
    JSON.stringify(await bodyOf(response)) ===
      JSON.stringify({ error: "Unable to import item rows." }),
    "expected the insert failure message",
  );
});

Deno.test("bulk_import_items records status history only for tracked statuses", async () => {
  let historyInsertPayload: unknown = null;
  const { client } = makeClient((call) => {
    if (call.table === "items" && call.operations.some((op) => op.method === "in")) {
      return { data: [], error: null };
    }
    if (call.table === "items" && call.operations.some((op) => op.method === "insert")) {
      return {
        data: [
          {
            id: "item-1",
            workspace_id: "ws-1",
            name: "Broken Widget",
            barcode: "ITEM-1",
            serial_number: null,
            status: "damaged",
            notes: "cracked",
          },
          {
            id: "item-2",
            workspace_id: "ws-1",
            name: "Fine Widget",
            barcode: "ITEM-2",
            serial_number: null,
            status: "available",
            notes: null,
          },
        ],
        error: null,
      };
    }
    if (call.table === "item_status_history") {
      const insertOp = call.operations.find((op) => op.method === "insert");
      historyInsertPayload = insertOp?.args[0] ?? null;
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
  const response = await handleBulkItemsAction(
    baseContext(client, {
      rows: [
        { name: "Broken Widget", barcode: "ITEM-1", status: "damaged", notes: "cracked" },
        { name: "Fine Widget", barcode: "ITEM-2", status: "available" },
      ],
    }),
  );
  const body = await bodyOf(response);
  const data = body.data as { inserted: number };

  assert(response.status === 200, "expected a 200 response");
  assert(data.inserted === 2, "expected both rows inserted");
  assert(Array.isArray(historyInsertPayload), "expected history insert to run");
  assert(
    (historyInsertPayload as unknown[]).length === 1,
    "expected only the damaged item to produce a history row",
  );
  assert(
    (historyInsertPayload as Array<{ status: string }>)[0].status === "damaged",
    "expected the history row status to be damaged",
  );
});

Deno.test("bulk_import_items skips the history insert when nothing tracked was inserted", async () => {
  let historyInsertCalled = false;
  const { client } = makeClient((call) => {
    if (call.table === "items" && call.operations.some((op) => op.method === "in")) {
      return { data: [], error: null };
    }
    if (call.table === "items" && call.operations.some((op) => op.method === "insert")) {
      return {
        data: [{
          id: "item-1",
          workspace_id: "ws-1",
          name: "Fine Widget",
          barcode: "ITEM-1",
          serial_number: null,
          status: "available",
          notes: null,
        }],
        error: null,
      };
    }
    if (call.table === "item_status_history") {
      historyInsertCalled = true;
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
  await handleBulkItemsAction(
    baseContext(client, { rows: [{ name: "Fine Widget", barcode: "ITEM-1" }] }),
  );

  assert(!historyInsertCalled, "history insert should not run for untracked statuses");
});

Deno.test("bulk_import_items defaults status to available and nulls empty optional fields", async () => {
  let insertPayload: unknown = null;
  const { client } = makeClient((call) => {
    if (call.table === "items" && call.operations.some((op) => op.method === "in")) {
      return { data: [], error: null };
    }
    if (call.table === "items" && call.operations.some((op) => op.method === "insert")) {
      const insertOp = call.operations.find((op) => op.method === "insert");
      insertPayload = insertOp?.args[0] ?? null;
      return {
        data: [{
          id: "item-1",
          workspace_id: "ws-1",
          name: "Bare Item",
          barcode: "ITEM-1",
          serial_number: null,
          status: "available",
          notes: null,
        }],
        error: null,
      };
    }
    return { data: null, error: null };
  });
  await handleBulkItemsAction(
    baseContext(client, { rows: [{ name: "Bare Item", barcode: "ITEM-1" }] }),
  );

  const row = (insertPayload as Array<Record<string, unknown>>)[0];
  assert(row.status === "available", "expected default status of available");
  assert(row.serial_number === null, "expected serial_number to default to null");
  assert(row.notes === null, "expected notes to default to null");
});
