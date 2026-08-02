import { handleStatusTrackingAction } from "./statusTracking.ts";
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

const baseContext = (adminClient: SupabaseClient): AdminOpsContext => ({
  requestId: "request-1",
  action: "get_status_tracking",
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

const isFlaggedQuery = (call: QueryCall) =>
  call.table === "items" && call.operations.some((op) => op.method === "not");
const isItemLookupQuery = (call: QueryCall) =>
  call.table === "items" && call.operations.some((op) => op.method === "in");

Deno.test("get_status_tracking joins flagged items with history and item metadata", async () => {
  const { client } = makeClient((call) => {
    if (isFlaggedQuery(call)) {
      return {
        data: [{
          id: "item-1",
          name: "Broken Widget",
          barcode: "ITEM-1",
          serial_number: null,
          status: "damaged",
          notes: "cracked",
          updated_at: "2026-01-02T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        }],
        error: null,
      };
    }
    if (isItemLookupQuery(call)) {
      return { data: [{ id: "item-1", name: "Broken Widget", barcode: "ITEM-1" }], error: null };
    }
    if (call.table === "item_status_history") {
      return {
        data: [{
          id: "h1",
          item_id: "item-1",
          status: "damaged",
          note: "cracked",
          changed_at: "2026-01-02T00:00:00.000Z",
          changed_by: "user-1",
        }],
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const response = await handleStatusTrackingAction(baseContext(client));
  const body = await bodyOf(response);
  const data = body.data as { flagged_items: unknown[]; history: Array<{ item: unknown }> };

  assert(response.status === 200, "expected 200");
  assert(data.flagged_items.length === 1, "expected one flagged item");
  assert(data.history.length === 1, "expected one history row");
  assert(
    JSON.stringify(data.history[0].item) === JSON.stringify({ name: "Broken Widget", barcode: "ITEM-1" }),
    "expected the history row to be joined with item metadata",
  );
});

Deno.test("get_status_tracking falls back to created_at when updated_at column is missing", async () => {
  let fallbackCalled = false;
  const { client } = makeClient((call) => {
    if (isFlaggedQuery(call)) {
      if (call.operations.some((op) => op.method === "order" && op.args[0] === "created_at")) {
        fallbackCalled = true;
        return {
          data: [{
            id: "item-1",
            name: "Broken Widget",
            barcode: "ITEM-1",
            serial_number: null,
            status: "damaged",
            notes: null,
            created_at: "2026-01-01T00:00:00.000Z",
          }],
          error: null,
        };
      }
      return {
        data: null,
        error: { code: "42703", message: 'column "updated_at" does not exist' },
      };
    }
    if (call.table === "item_status_history") {
      return { data: [], error: null };
    }
    return { data: null, error: null };
  });
  const response = await handleStatusTrackingAction(baseContext(client));
  const body = await bodyOf(response);
  const data = body.data as { flagged_items: Array<{ updated_at: string }> };

  assert(response.status === 200, "expected 200 via the fallback path");
  assert(fallbackCalled, "expected the created_at fallback query to run");
  assert(
    data.flagged_items[0].updated_at === "2026-01-01T00:00:00.000Z",
    "expected updated_at to be backfilled from created_at",
  );
});

Deno.test("get_status_tracking returns 400 when the updated_at fallback query also fails", async () => {
  const { client } = makeClient((call) => {
    if (isFlaggedQuery(call)) {
      if (call.operations.some((op) => op.method === "order" && op.args[0] === "created_at")) {
        return { data: null, error: { code: "500", message: "still broken" } };
      }
      return {
        data: null,
        error: { code: "42703", message: 'column "updated_at" does not exist' },
      };
    }
    return { data: [], error: null };
  });
  const response = await handleStatusTrackingAction(baseContext(client));

  assert(response.status === 400, "expected 400 when the fallback query also fails");
  assert(
    JSON.stringify(await bodyOf(response)) ===
      JSON.stringify({ error: "Unable to load status tracking." }),
    "expected the load-failure error message",
  );
});

Deno.test("get_status_tracking returns 400 immediately on an unrelated flagged-items error", async () => {
  const { client, calls } = makeClient((call) => {
    if (isFlaggedQuery(call)) {
      return { data: null, error: { code: "500", message: "table is on fire" } };
    }
    return { data: [], error: null };
  });
  const response = await handleStatusTrackingAction(baseContext(client));

  assert(response.status === 400, "expected 400 for an unrelated error");
  assert(
    !calls.some(isItemLookupQuery),
    "should not attempt the item metadata lookup after a hard failure",
  );
});

Deno.test("get_status_tracking returns 400 when the history query fails for a reason other than a missing relation", async () => {
  const { client } = makeClient((call) => {
    if (isFlaggedQuery(call)) return { data: [], error: null };
    if (call.table === "item_status_history") {
      return { data: null, error: { code: "500", message: "history table exploded" } };
    }
    return { data: null, error: null };
  });
  const response = await handleStatusTrackingAction(baseContext(client));

  assert(response.status === 400, "expected 400 for a hard history-query failure");
});

Deno.test("get_status_tracking tolerates a missing item_status_history relation and returns empty history", async () => {
  const { client } = makeClient((call) => {
    if (isFlaggedQuery(call)) {
      return {
        data: [{
          id: "item-1",
          name: "Broken Widget",
          barcode: "ITEM-1",
          serial_number: null,
          status: "damaged",
          notes: null,
          updated_at: "2026-01-01T00:00:00.000Z",
        }],
        error: null,
      };
    }
    if (call.table === "item_status_history") {
      return {
        data: null,
        error: { code: "42P01", message: 'relation "item_status_history" does not exist' },
      };
    }
    return { data: null, error: null };
  });
  const response = await handleStatusTrackingAction(baseContext(client));
  const body = await bodyOf(response);
  const data = body.data as { flagged_items: unknown[]; history: unknown[] };

  assert(response.status === 200, "expected 200 despite the missing relation");
  assert(data.flagged_items.length === 1, "expected flagged items to still load");
  assert(data.history.length === 0, "expected history to be empty when the relation is missing");
});

Deno.test("get_status_tracking skips the item metadata lookup when there is no history", async () => {
  const { client, calls } = makeClient((call) => {
    if (isFlaggedQuery(call)) return { data: [], error: null };
    if (call.table === "item_status_history") return { data: [], error: null };
    return { data: null, error: null };
  });
  const response = await handleStatusTrackingAction(baseContext(client));
  const body = await bodyOf(response);
  const data = body.data as { flagged_items: unknown[]; history: unknown[] };

  assert(response.status === 200, "expected 200");
  assert(data.flagged_items.length === 0, "expected no flagged items");
  assert(data.history.length === 0, "expected no history");
  assert(
    !calls.some(isItemLookupQuery),
    "should not query item metadata when there is no history to join",
  );
});

Deno.test("get_status_tracking sets item to null when history references an item missing from the lookup", async () => {
  const { client } = makeClient((call) => {
    if (isFlaggedQuery(call)) return { data: [], error: null };
    if (isItemLookupQuery(call)) return { data: [], error: null };
    if (call.table === "item_status_history") {
      return {
        data: [{
          id: "h1",
          item_id: "missing-item",
          status: "lost",
          note: null,
          changed_at: "2026-01-01T00:00:00.000Z",
          changed_by: null,
        }],
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const response = await handleStatusTrackingAction(baseContext(client));
  const body = await bodyOf(response);
  const data = body.data as { history: Array<{ item: unknown }> };

  assert(data.history[0].item === null, "expected item to be null for an unresolved item_id");
});
