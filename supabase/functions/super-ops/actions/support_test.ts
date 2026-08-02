import { handleSupportAction, SUPPORT_ACTIONS } from "./support.ts";
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

const buildAdminClient = (
  tables: Record<string, TableConfig>,
  storage?: unknown,
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
  const client: Record<string, unknown> = { from };
  if (storage) client.storage = storage;
  return client;
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

const REQUEST_ID = "50000000-0000-4000-8000-000000000001";

Deno.test("SUPPORT_ACTIONS exposes exactly three actions", () => {
  assert(SUPPORT_ACTIONS.length === 3, "expected 3 actions");
});

Deno.test("handleSupportAction returns null for unrelated actions", async () => {
  const response = await handleSupportAction(
    contextFor("some_other_action", {}, buildAdminClient({})),
  );
  assert(response === null, "expected null for unhandled action");
});

// ── list_support_requests ────────────────────────────────────────────────────

Deno.test("list_support_requests rejects an unrecognized status filter", async () => {
  const response = await handleSupportAction(
    contextFor(
      "list_support_requests",
      { status: "archived" },
      buildAdminClient({}),
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Invalid support request status.",
    "expected status error",
  );
});

Deno.test("list_support_requests rejects search text with disallowed characters", async () => {
  await assertThrows(
    () =>
      handleSupportAction(
        contextFor(
          "list_support_requests",
          { search: "abc%def" },
          buildAdminClient({}),
        ),
      ),
    "expected search validation to throw",
  );
});

Deno.test("list_support_requests returns requests on success", async () => {
  const requests = [{ id: REQUEST_ID, status: "open" }];
  const adminClient = buildAdminClient({
    support_requests: { data: requests, error: null },
  });
  const response = await handleSupportAction(
    contextFor(
      "list_support_requests",
      { status: "open", search: "Lincoln" },
      adminClient,
    ),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.data.requests.length === 1, "expected one request");
});

Deno.test("list_support_requests surfaces a database error", async () => {
  const adminClient = buildAdminClient({
    support_requests: { data: null, error: { message: "db down" } },
  });
  const response = await handleSupportAction(
    contextFor("list_support_requests", {}, adminClient),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Unable to load support requests.",
    "expected load error",
  );
});

// ── get_support_request ──────────────────────────────────────────────────────

Deno.test("get_support_request rejects an invalid request id", async () => {
  await assertThrows(
    () =>
      handleSupportAction(
        contextFor(
          "get_support_request",
          { support_request_id: "not-a-uuid" },
          buildAdminClient({}),
        ),
      ),
    "expected id validation to throw",
  );
});

Deno.test("get_support_request returns 400 when the request is not found", async () => {
  const adminClient = buildAdminClient({
    support_requests: { data: null, error: null },
  });
  const response = await handleSupportAction(
    contextFor(
      "get_support_request",
      { support_request_id: REQUEST_ID },
      adminClient,
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Support request not found.",
    "expected not-found error",
  );
});

Deno.test("get_support_request returns 400 when attachments fail to load", async () => {
  const requestRow = {
    id: REQUEST_ID,
    requester_name: "Jane",
    reply_email: "jane@example.test",
    subject: "Broken scanner",
    category: "hardware",
    message: "It won't scan.",
    source: "web",
    status: "open",
    assigned_to: null,
    internal_notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
  const adminClient = buildAdminClient({
    support_requests: { data: requestRow, error: null },
    support_request_attachments: { data: null, error: { message: "db down" } },
    support_request_events: { data: [], error: null },
  });
  const response = await handleSupportAction(
    contextFor(
      "get_support_request",
      { support_request_id: REQUEST_ID },
      adminClient,
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Unable to load support request details.",
    "expected details error",
  );
});

Deno.test("get_support_request resolves assignee email and signs safe attachments only", async () => {
  const assignedTo = "00000000-0000-4000-8000-000000000009";
  const safeFileId = "60000000-0000-4000-8000-000000000001";
  const requestRow = {
    id: REQUEST_ID,
    requester_name: "Jane",
    reply_email: "jane@example.test",
    subject: "Broken scanner",
    category: "hardware",
    message: "It won't scan.",
    source: "web",
    status: "open",
    assigned_to: assignedTo,
    internal_notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
  const attachments = [
    {
      id: "att-safe",
      original_filename: "photo.png",
      stored_filename: "stored.png",
      content_type: "image/png",
      size_bytes: 1024,
      storage_bucket: "support-request-attachments",
      storage_path: `${REQUEST_ID}/${safeFileId}.png`,
    },
    {
      id: "att-unsafe",
      original_filename: "evil.png",
      stored_filename: "stored2.png",
      content_type: "image/png",
      size_bytes: 2048,
      storage_bucket: "support-request-attachments",
      storage_path: "../../etc/passwd",
    },
  ];
  const events = [
    {
      id: "evt-1",
      actor_id: assignedTo,
      actor_email: "agent@example.test",
      event_type: "updated",
      metadata: {},
      created_at: "2026-08-01T00:00:00.000Z",
    },
  ];

  let signedUrlCalls = 0;
  const storage = {
    from: (bucket: string) => ({
      createSignedUrl: (path: string, _ttl: number) => {
        signedUrlCalls++;
        assert(bucket === "support-request-attachments", "expected correct bucket");
        return Promise.resolve({
          data: { signedUrl: `https://signed.example/${path}` },
          error: null,
        });
      },
    }),
  };

  const adminClient = buildAdminClient(
    {
      support_requests: { data: requestRow, error: null },
      support_request_attachments: { data: attachments, error: null },
      support_request_events: { data: events, error: null },
      profiles: { data: { auth_email: "agent@example.test" }, error: null },
    },
    storage,
  );

  const response = await handleSupportAction(
    contextFor(
      "get_support_request",
      { support_request_id: REQUEST_ID },
      adminClient,
    ),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  const request = body.data.request;
  assert(request.assigned_to_email === "agent@example.test", "expected assignee email");
  assert(signedUrlCalls === 1, `expected exactly one signed url call, got ${signedUrlCalls}`);
  const safeAttachment = request.attachments.find((a: any) => a.id === "att-safe");
  const unsafeAttachment = request.attachments.find((a: any) => a.id === "att-unsafe");
  assert(
    safeAttachment.signed_url === `https://signed.example/${REQUEST_ID}/${safeFileId}.png`,
    "expected signed url for safe attachment",
  );
  assert(unsafeAttachment.signed_url === null, "expected null signed url for unsafe path");
  assert(request.events.length === 1, "expected events included");
});

Deno.test("get_support_request treats a bucket mismatch as an unsafe attachment path", async () => {
  const requestRow = {
    id: REQUEST_ID,
    requester_name: "Jane",
    reply_email: "jane@example.test",
    subject: "s",
    category: "other",
    message: "m",
    source: "web",
    status: "open",
    assigned_to: null,
    internal_notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
  const attachments = [
    {
      id: "att-1",
      original_filename: "f.png",
      stored_filename: "f.png",
      content_type: "image/png",
      size_bytes: 10,
      storage_bucket: "some-other-bucket",
      storage_path: `${REQUEST_ID}/60000000-0000-4000-8000-000000000002.png`,
    },
  ];
  const adminClient = buildAdminClient({
    support_requests: { data: requestRow, error: null },
    support_request_attachments: { data: attachments, error: null },
    support_request_events: { data: [], error: null },
  });
  const response = await handleSupportAction(
    contextFor(
      "get_support_request",
      { support_request_id: REQUEST_ID },
      adminClient,
    ),
  );
  const body = await response!.json() as Record<string, any>;
  assert(
    body.data.request.attachments[0].signed_url === null,
    "expected null signed url for bucket mismatch",
  );
});

Deno.test("get_support_request treats a disallowed extension as an unsafe attachment path", async () => {
  const requestRow = {
    id: REQUEST_ID,
    requester_name: "Jane",
    reply_email: "jane@example.test",
    subject: "s",
    category: "other",
    message: "m",
    source: "web",
    status: "open",
    assigned_to: null,
    internal_notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
  const attachments = [
    {
      id: "att-1",
      original_filename: "f.pdf",
      stored_filename: "f.pdf",
      content_type: "application/pdf",
      size_bytes: 10,
      storage_bucket: "support-request-attachments",
      storage_path: `${REQUEST_ID}/60000000-0000-4000-8000-000000000003.pdf`,
    },
  ];
  const adminClient = buildAdminClient({
    support_requests: { data: requestRow, error: null },
    support_request_attachments: { data: attachments, error: null },
    support_request_events: { data: [], error: null },
  });
  const response = await handleSupportAction(
    contextFor(
      "get_support_request",
      { support_request_id: REQUEST_ID },
      adminClient,
    ),
  );
  const body = await response!.json() as Record<string, any>;
  assert(
    body.data.request.attachments[0].signed_url === null,
    "expected null signed url for disallowed extension",
  );
});

Deno.test("get_support_request treats a malformed path with too many segments as unsafe", async () => {
  const requestRow = {
    id: REQUEST_ID,
    requester_name: "Jane",
    reply_email: "jane@example.test",
    subject: "s",
    category: "other",
    message: "m",
    source: "web",
    status: "open",
    assigned_to: null,
    internal_notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
  const attachments = [
    {
      id: "att-1",
      original_filename: "f.png",
      stored_filename: "f.png",
      content_type: "image/png",
      size_bytes: 10,
      storage_bucket: "support-request-attachments",
      storage_path: `${REQUEST_ID}/extra/60000000-0000-4000-8000-000000000004.png`,
    },
  ];
  const adminClient = buildAdminClient({
    support_requests: { data: requestRow, error: null },
    support_request_attachments: { data: attachments, error: null },
    support_request_events: { data: [], error: null },
  });
  const response = await handleSupportAction(
    contextFor(
      "get_support_request",
      { support_request_id: REQUEST_ID },
      adminClient,
    ),
  );
  const body = await response!.json() as Record<string, any>;
  assert(
    body.data.request.attachments[0].signed_url === null,
    "expected null signed url for malformed path segments",
  );
});

// ── update_support_request ───────────────────────────────────────────────────

Deno.test("update_support_request rejects an invalid request id", async () => {
  await assertThrows(
    () =>
      handleSupportAction(
        contextFor(
          "update_support_request",
          { support_request_id: "not-a-uuid" },
          buildAdminClient({}),
        ),
      ),
    "expected id validation to throw",
  );
});

Deno.test("update_support_request rejects an unrecognized status", async () => {
  const response = await handleSupportAction(
    contextFor(
      "update_support_request",
      { support_request_id: REQUEST_ID, status: "archived" },
      buildAdminClient({}),
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Invalid support request status.",
    "expected status error",
  );
});

Deno.test("update_support_request rejects assigning to me and clearing assignment together", async () => {
  const response = await handleSupportAction(
    contextFor(
      "update_support_request",
      {
        support_request_id: REQUEST_ID,
        assign_to_me: true,
        clear_assignment: true,
      },
      buildAdminClient({}),
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Invalid assignment request.",
    "expected assignment conflict error",
  );
});

Deno.test("update_support_request returns 400 when the existing request is not found", async () => {
  const adminClient = buildAdminClient({
    support_requests: { data: null, error: null },
  });
  const response = await handleSupportAction(
    contextFor(
      "update_support_request",
      { support_request_id: REQUEST_ID, status: "resolved" },
      adminClient,
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Support request not found.",
    "expected not-found error",
  );
});

Deno.test("update_support_request returns the existing detail when there are no changes", async () => {
  const existing = {
    id: REQUEST_ID,
    status: "open",
    internal_notes: "",
    assigned_to: null,
  };
  const detailRow = {
    id: REQUEST_ID,
    requester_name: "Jane",
    reply_email: "jane@example.test",
    subject: "s",
    category: "other",
    message: "m",
    source: "web",
    status: "open",
    assigned_to: null,
    internal_notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
  const adminClient = buildAdminClient({
    support_requests: [
      { data: existing, error: null },
      { data: detailRow, error: null },
    ],
    support_request_attachments: { data: [], error: null },
    support_request_events: { data: [], error: null },
  });
  const response = await handleSupportAction(
    contextFor(
      "update_support_request",
      { support_request_id: REQUEST_ID, status: "open" },
      adminClient,
    ),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.data.request.id === REQUEST_ID, "expected request detail in response");
});

Deno.test("update_support_request surfaces a database error on update", async () => {
  const existing = {
    id: REQUEST_ID,
    status: "open",
    internal_notes: "",
    assigned_to: null,
  };
  const adminClient = buildAdminClient({
    support_requests: [
      { data: existing, error: null },
      { data: null, error: { message: "db down" } },
    ],
  });
  const response = await handleSupportAction(
    contextFor(
      "update_support_request",
      { support_request_id: REQUEST_ID, status: "resolved" },
      adminClient,
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Unable to update support request.",
    "expected update error",
  );
});

Deno.test("update_support_request applies status, notes, and self-assignment changes with audit trail", async () => {
  const existing = {
    id: REQUEST_ID,
    status: "open",
    internal_notes: "",
    assigned_to: null,
  };
  const detailRow = {
    id: REQUEST_ID,
    requester_name: "Jane",
    reply_email: "jane@example.test",
    subject: "s",
    category: "other",
    message: "m",
    source: "web",
    status: "resolved",
    assigned_to: "00000000-0000-4000-8000-000000000001",
    internal_notes: "Fixed it.",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:05:00.000Z",
  };
  const auditCalls: unknown[][] = [];
  const adminClient = buildAdminClient({
    support_requests: [
      { data: existing, error: null },
      { data: null, error: null }, // update() result: only `error` is read
      { data: detailRow, error: null },
    ],
    support_request_events: [
      { data: null, error: null }, // insert from writeSupportRequestEvent
      { data: [], error: null }, // select in buildSupportRequestDetail
    ],
    support_request_attachments: { data: [], error: null },
    profiles: {
      data: { auth_email: "admin@example.test" },
      error: null,
    },
  });
  const response = await handleSupportAction(
    contextFor(
      "update_support_request",
      {
        support_request_id: REQUEST_ID,
        status: "resolved",
        internal_notes: "Fixed it.",
        assign_to_me: true,
      },
      adminClient,
      (...args) => {
        auditCalls.push(args);
        return Promise.resolve();
      },
    ),
  );
  assert(response!.status === 200, `expected 200, got ${response!.status}`);
  const body = await response!.json() as Record<string, any>;
  assert(body.data.request.status === "resolved", "expected resolved status in detail");
  assert(auditCalls.length === 1, "expected an audit call");
  assert(auditCalls[0][0] === "update_support_request", "expected audit action type");
  assert(auditCalls[0][2] === REQUEST_ID, "expected audit target id");
});

Deno.test("update_support_request clears an existing assignment", async () => {
  const existing = {
    id: REQUEST_ID,
    status: "open",
    internal_notes: "",
    assigned_to: "00000000-0000-4000-8000-000000000009",
  };
  const detailRow = {
    id: REQUEST_ID,
    requester_name: "Jane",
    reply_email: "jane@example.test",
    subject: "s",
    category: "other",
    message: "m",
    source: "web",
    status: "open",
    assigned_to: null,
    internal_notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:05:00.000Z",
  };
  const adminClient = buildAdminClient({
    support_requests: [
      { data: existing, error: null },
      { data: null, error: null },
      { data: detailRow, error: null },
    ],
    support_request_events: [
      { data: null, error: null },
      { data: [], error: null },
    ],
    support_request_attachments: { data: [], error: null },
  });
  const response = await handleSupportAction(
    contextFor(
      "update_support_request",
      { support_request_id: REQUEST_ID, clear_assignment: true },
      adminClient,
    ),
  );
  assert(response!.status === 200, `expected 200, got ${response!.status}`);
  const body = await response!.json() as Record<string, any>;
  assert(body.data.request.assigned_to === null, "expected cleared assignment");
});

Deno.test("update_support_request returns an error when the post-update detail fetch fails", async () => {
  const existing = {
    id: REQUEST_ID,
    status: "open",
    internal_notes: "",
    assigned_to: null,
  };
  const adminClient = buildAdminClient({
    support_requests: [
      { data: existing, error: null },
      { data: null, error: null },
      { data: null, error: null }, // detail re-fetch: not found
    ],
    support_request_events: [
      { data: null, error: null },
    ],
  });
  const response = await handleSupportAction(
    contextFor(
      "update_support_request",
      { support_request_id: REQUEST_ID, status: "resolved" },
      adminClient,
    ),
  );
  assert(response!.status === 400, "expected 400");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Support request not found.",
    "expected not-found error on re-fetch",
  );
});
