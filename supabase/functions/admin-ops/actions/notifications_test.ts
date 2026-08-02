import {
  handleNotificationAction,
  normalizeWorkspaceUpdates,
  resolveMaintenance,
} from "./notifications.ts";
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
  action: "get_notifications",
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
  ...overrides,
});

const bodyOf = (response: Response) =>
  response.json() as Promise<Record<string, unknown>>;

Deno.test("get_notifications reports flagged/overdue counts and echoes context config", async () => {
  const { client } = makeClient((call) => {
    if (call.table === "items" && call.operations.some((op) => op.method === "lte")) {
      return { data: null, error: null, count: 5 };
    }
    if (call.table === "items" && call.operations.some((op) => op.method === "not")) {
      return { data: null, error: null, count: 3 };
    }
    if (call.table === "item_status_history") {
      return {
        data: [{ id: "h1", status: "damaged", changed_at: "2026-01-01T00:00:00.000Z" }],
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const response = await handleNotificationAction(
    baseContext(client, {
      checkoutDueHours: 48,
      maintenance: { enabled: true, message: "Upgrading" },
      workspaceUpdates: [{
        id: "u1",
        title: "Heads up",
        message: "New feature",
        level: "info",
        created_at: "2026-01-01T00:00:00.000Z",
        link_url: null,
      }],
    }),
  );
  const body = await bodyOf(response);
  const data = body.data as Record<string, unknown>;

  assert(response.status === 200, "expected 200");
  assert(data.overdue_count === 5, `expected overdue_count 5, got ${data.overdue_count}`);
  assert(data.flagged_count === 3, `expected flagged_count 3, got ${data.flagged_count}`);
  assert(data.checkout_due_hours === 48, "expected checkout_due_hours to be echoed");
  assert(
    (data.maintenance as { enabled: boolean }).enabled === true,
    "expected maintenance to be echoed",
  );
  assert(
    Array.isArray(data.recent_status_events) &&
      (data.recent_status_events as unknown[]).length === 1,
    "expected recent status events to come through",
  );
  assert(
    Array.isArray(data.updates) && (data.updates as unknown[]).length === 1,
    "expected workspace updates to be echoed",
  );
});

Deno.test("get_notifications treats query errors as zero counts and empty history", async () => {
  const { client } = makeClient((call) => {
    if (call.table === "items") {
      return { data: null, error: { code: "500", message: "boom" }, count: null };
    }
    if (call.table === "item_status_history") {
      return { data: null, error: { code: "500", message: "boom" } };
    }
    return { data: null, error: null };
  });
  const response = await handleNotificationAction(baseContext(client));
  const body = await bodyOf(response);
  const data = body.data as Record<string, unknown>;

  assert(response.status === 200, "errors should still produce a 200 with safe defaults");
  assert(data.overdue_count === 0, "expected overdue_count to fall back to 0");
  assert(data.flagged_count === 0, "expected flagged_count to fall back to 0");
  assert(
    Array.isArray(data.recent_status_events) &&
      (data.recent_status_events as unknown[]).length === 0,
    "expected recent_status_events to fall back to []",
  );
});

Deno.test("get_notifications derives the overdue cutoff from checkoutDueHours", async () => {
  let capturedCutoff: string | null = null;
  const { client } = makeClient((call) => {
    if (call.table === "items" && call.operations.some((op) => op.method === "lte")) {
      const lteOp = call.operations.find((op) => op.method === "lte");
      capturedCutoff = (lteOp?.args[1] as string) ?? null;
      return { data: null, error: null, count: 0 };
    }
    return { data: null, error: null, count: 0 };
  });
  const beforeMs = Date.now() - 24 * 60 * 60 * 1000;
  await handleNotificationAction(baseContext(client, { checkoutDueHours: 24 }));
  const afterMs = Date.now() - 24 * 60 * 60 * 1000;

  assert(capturedCutoff !== null, "expected the overdue query to run with a cutoff");
  const cutoffMs = Date.parse(capturedCutoff as unknown as string);
  assert(
    cutoffMs >= beforeMs - 1000 && cutoffMs <= afterMs + 1000,
    "expected the cutoff to reflect checkoutDueHours",
  );
});

Deno.test("normalizeWorkspaceUpdates returns [] for non-object input", () => {
  assert(normalizeWorkspaceUpdates(null).length === 0, "null -> []");
  assert(normalizeWorkspaceUpdates(undefined).length === 0, "undefined -> []");
  assert(normalizeWorkspaceUpdates("nope").length === 0, "string -> []");
  assert(normalizeWorkspaceUpdates(42).length === 0, "number -> []");
});

Deno.test("normalizeWorkspaceUpdates returns [] when disabled or items missing", () => {
  assert(
    normalizeWorkspaceUpdates({ enabled: false, items: [{ message: "hi" }] }).length === 0,
    "enabled:false should short-circuit",
  );
  assert(
    normalizeWorkspaceUpdates({ enabled: true }).length === 0,
    "missing items array should short-circuit",
  );
  assert(
    normalizeWorkspaceUpdates({ enabled: true, items: "not-an-array" }).length === 0,
    "non-array items should short-circuit",
  );
});

Deno.test("normalizeWorkspaceUpdates filters non-object entries and blank messages", () => {
  const result = normalizeWorkspaceUpdates({
    enabled: true,
    items: [null, "x", 5, { title: "No message" }, { message: "  " }, { message: "Keep me" }],
  });
  assert(result.length === 1, `expected 1 surviving item, got ${result.length}`);
  assert(result[0].message === "Keep me", "expected the valid message to survive");
});

Deno.test("normalizeWorkspaceUpdates applies defaults for title, level, created_at and id", () => {
  const result = normalizeWorkspaceUpdates({
    enabled: true,
    items: [{ message: "Just a message" }],
  });
  assert(result.length === 1, "expected one item");
  const item = result[0];
  assert(item.title === "Product update", "expected default title");
  assert(item.level === "info", "expected default level");
  assert(typeof item.created_at === "string" && item.created_at.length > 0, "expected created_at to be set");
  assert(item.id === `${item.created_at}-0`, "expected id to derive from created_at and index");
  assert(item.link_url === null, "expected link_url to default to null");
});

Deno.test("normalizeWorkspaceUpdates preserves explicit level, id, link_url, and trims blanks", () => {
  const result = normalizeWorkspaceUpdates({
    enabled: true,
    items: [
      {
        id: "custom-id",
        title: "  Spaced title  ",
        message: "  Spaced message  ",
        level: "critical",
        created_at: "2026-02-01T00:00:00.000Z",
        link_url: "  https://example.com  ",
      },
      { message: "warn me", level: "warning" },
      { message: "bogus level", level: "not-a-level" },
    ],
  });
  assert(result[0].id === "custom-id", "expected explicit id to be preserved");
  assert(result[0].title === "Spaced title", "expected title to be trimmed");
  assert(result[0].message === "Spaced message", "expected message to be trimmed");
  assert(result[0].level === "critical", "expected explicit critical level");
  assert(result[0].link_url === "https://example.com", "expected link_url to be trimmed");
  assert(result[1].level === "warning", "expected explicit warning level");
  assert(result[2].level === "info", "expected invalid level to fall back to info");
});

Deno.test("normalizeWorkspaceUpdates caps output at 5 items", () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ message: `msg-${i}` }));
  const result = normalizeWorkspaceUpdates({ enabled: true, items });
  assert(result.length === 5, `expected at most 5 items, got ${result.length}`);
});

Deno.test("resolveMaintenance returns disabled default for non-object input", () => {
  const result = resolveMaintenance(null);
  assert(result.enabled === false, "expected disabled by default");
  assert(result.message === "", "expected empty message by default");
  assert(resolveMaintenance("nope").enabled === false, "string input should default to disabled");
  assert(resolveMaintenance(undefined).enabled === false, "undefined input should default to disabled");
});

Deno.test("resolveMaintenance requires enabled === true strictly", () => {
  assert(resolveMaintenance({ enabled: "true" }).enabled === false, "string 'true' should not enable");
  assert(resolveMaintenance({ enabled: 1 }).enabled === false, "number 1 should not enable");
  assert(resolveMaintenance({ enabled: true }).enabled === true, "boolean true should enable");
});

Deno.test("resolveMaintenance falls back to a default message when enabled without text", () => {
  const withoutMessage = resolveMaintenance({ enabled: true });
  assert(
    withoutMessage.message === "Maintenance in progress.",
    "expected the default maintenance message",
  );
  const withBlankMessage = resolveMaintenance({ enabled: true, message: "   " });
  assert(
    withBlankMessage.message === "Maintenance in progress.",
    "expected blank message to fall back to default",
  );
  const withMessage = resolveMaintenance({ enabled: true, message: "  Down for repairs  " });
  assert(
    withMessage.message === "Down for repairs",
    "expected explicit message to be trimmed and preserved",
  );
});
