import {
  handleSubprocessorsAction,
  SUBPROCESSOR_ACTIONS,
} from "./subprocessors.ts";
import type { SuperOpsContext } from "../context.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertThrowsWith = async (
  fn: () => Promise<unknown>,
  expectedSubstring: string,
) => {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(
      message.includes(expectedSubstring),
      `expected error message to include "${expectedSubstring}", got "${message}"`,
    );
    return;
  }
  throw new Error(`expected a throw containing "${expectedSubstring}"`);
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

// Well past the 30-day minimum lead time from any plausible "today".
const FAR_FUTURE_DATE = "2099-01-15";
const TOO_SOON_DATE = "2026-08-05";

const withEnv = async (
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
) => {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = Deno.env.get(key);
    const value = vars[key];
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(previous)) {
      const value = previous[key];
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
};

Deno.test("SUBPROCESSOR_ACTIONS exposes exactly three actions", () => {
  assert(SUBPROCESSOR_ACTIONS.length === 3, "expected 3 actions");
});

Deno.test("handleSubprocessorsAction returns null for unrelated actions", async () => {
  const response = await handleSubprocessorsAction(
    contextFor("some_other_action", {}, buildAdminClient({})),
  );
  assert(response === null, "expected null for unhandled action");
});

// ── preview_subprocessor_notice ──────────────────────────────────────────────

Deno.test("preview_subprocessor_notice rejects a missing vendor", async () => {
  await assertThrowsWith(
    () =>
      handleSubprocessorsAction(
        contextFor(
          "preview_subprocessor_notice",
          { change_type: "added", effective_date: FAR_FUTURE_DATE },
          buildAdminClient({}),
        ),
      ),
    "Invalid request",
  );
});

Deno.test("preview_subprocessor_notice rejects an invalid change type", async () => {
  await assertThrowsWith(
    () =>
      handleSubprocessorsAction(
        contextFor(
          "preview_subprocessor_notice",
          {
            vendor: "Resend",
            change_type: "sidelined",
            effective_date: FAR_FUTURE_DATE,
          },
          buildAdminClient({}),
        ),
      ),
    "change_type must be",
  );
});

Deno.test("preview_subprocessor_notice rejects a malformed effective date", async () => {
  await assertThrowsWith(
    () =>
      handleSubprocessorsAction(
        contextFor(
          "preview_subprocessor_notice",
          { vendor: "Resend", change_type: "added", effective_date: "2026/08/05" },
          buildAdminClient({}),
        ),
      ),
    "effective_date must be YYYY-MM-DD",
  );
});

Deno.test("preview_subprocessor_notice rejects an invalid calendar date", async () => {
  await assertThrowsWith(
    () =>
      handleSubprocessorsAction(
        contextFor(
          "preview_subprocessor_notice",
          { vendor: "Resend", change_type: "added", effective_date: "2026-02-31" },
          buildAdminClient({}),
        ),
      ),
    "effective_date must be a valid date",
  );
});

Deno.test("preview_subprocessor_notice rejects an effective date under 30 days out", async () => {
  await assertThrowsWith(
    () =>
      handleSubprocessorsAction(
        contextFor(
          "preview_subprocessor_notice",
          { vendor: "Resend", change_type: "added", effective_date: TOO_SOON_DATE },
          buildAdminClient({}),
        ),
      ),
    "at least 30 days",
  );
});

Deno.test("preview_subprocessor_notice returns a preview with deduped recipient count", async () => {
  const adminClient = buildAdminClient({
    workspace_policies: {
      data: [
        { billing_email: "Ops@School.edu" },
        { billing_email: "ops@school.edu" },
      ],
      error: null,
    },
    sales_leads: {
      data: [{ reply_email: "billing@district.org" }],
      error: null,
    },
  });
  const response = await handleSubprocessorsAction(
    contextFor(
      "preview_subprocessor_notice",
      {
        vendor: "Resend",
        change_type: "added",
        effective_date: FAR_FUTURE_DATE,
        description: "For transactional email.",
      },
      adminClient,
    ),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.preview.targetCount === 2, `expected 2 recipients, got ${body.preview.targetCount}`);
  assert(
    body.preview.subject.includes("Resend"),
    "expected subject to include vendor",
  );
});

Deno.test("preview_subprocessor_notice propagates a recipient-load failure", async () => {
  const adminClient = buildAdminClient({
    workspace_policies: { data: null, error: { message: "db down" } },
  });
  await assertThrowsWith(
    () =>
      handleSubprocessorsAction(
        contextFor(
          "preview_subprocessor_notice",
          { vendor: "Resend", change_type: "added", effective_date: FAR_FUTURE_DATE },
          adminClient,
        ),
      ),
    "Unable to load subprocessor notice recipients.",
  );
});

// ── announce_subprocessor_change ─────────────────────────────────────────────

Deno.test("announce_subprocessor_change rejects a missing vendor", async () => {
  await assertThrowsWith(
    () =>
      handleSubprocessorsAction(
        contextFor(
          "announce_subprocessor_change",
          { change_type: "added", effective_date: FAR_FUTURE_DATE },
          buildAdminClient({}),
        ),
      ),
    "Invalid request",
  );
});

Deno.test("announce_subprocessor_change rejects an invalid change type", async () => {
  await assertThrowsWith(
    () =>
      handleSubprocessorsAction(
        contextFor(
          "announce_subprocessor_change",
          { vendor: "Resend", change_type: "sidelined", effective_date: FAR_FUTURE_DATE },
          buildAdminClient({}),
        ),
      ),
    "change_type must be",
  );
});

Deno.test("announce_subprocessor_change rejects an effective date under 30 days out", async () => {
  await assertThrowsWith(
    () =>
      handleSubprocessorsAction(
        contextFor(
          "announce_subprocessor_change",
          { vendor: "Resend", change_type: "added", effective_date: TOO_SOON_DATE },
          buildAdminClient({}),
        ),
      ),
    "at least 30 days",
  );
});

Deno.test("announce_subprocessor_change returns 503 when the email service is not configured", async () => {
  await withEnv({ ITX_RESEND_API_KEY: undefined }, async () => {
    const response = await handleSubprocessorsAction(
      contextFor(
        "announce_subprocessor_change",
        { vendor: "Resend", change_type: "added", effective_date: FAR_FUTURE_DATE },
        buildAdminClient({}),
      ),
    );
    assert(response!.status === 503, "expected 503");
    const body = await response!.json() as Record<string, unknown>;
    assert(
      body.error === "Email service not configured.",
      "expected email service error",
    );
  });
});

Deno.test("announce_subprocessor_change returns 500 when the change record cannot be created", async () => {
  await withEnv({ ITX_RESEND_API_KEY: "test-resend-key" }, async () => {
    const adminClient = buildAdminClient({
      subprocessor_changes: [{ data: null, error: { message: "db down" } }],
    });
    const response = await handleSubprocessorsAction(
      contextFor(
        "announce_subprocessor_change",
        { vendor: "Resend", change_type: "added", effective_date: FAR_FUTURE_DATE },
        adminClient,
      ),
    );
    assert(response!.status === 500, "expected 500");
    const body = await response!.json() as Record<string, unknown>;
    assert(
      body.error === "Failed to create subprocessor change record.",
      "expected create-record error",
    );
  });
});

Deno.test("announce_subprocessor_change succeeds with zero recipients and skips the email loop", async () => {
  await withEnv({ ITX_RESEND_API_KEY: "test-resend-key" }, async () => {
    const auditCalls: unknown[][] = [];
    const adminClient = buildAdminClient({
      workspace_policies: { data: [], error: null },
      sales_leads: { data: [], error: null },
      subprocessor_changes: [
        { data: { id: "change-1" }, error: null },
        { data: { id: "change-1" }, error: null },
      ],
    });
    const response = await handleSubprocessorsAction(
      contextFor(
        "announce_subprocessor_change",
        { vendor: "Resend", change_type: "added", effective_date: FAR_FUTURE_DATE },
        adminClient,
        (...args) => {
          auditCalls.push(args);
          return Promise.resolve();
        },
      ),
    );
    assert(response!.status === 200, "expected 200");
    const body = await response!.json() as Record<string, any>;
    assert(body.recipientsCount === 0, "expected zero recipients sent");
    assert(body.totalTargets === 0, "expected zero total targets");
    assert(body.changeId === "change-1", "expected change id in response");
    assert(auditCalls.length === 1, "expected an audit call");
  });
});

Deno.test("announce_subprocessor_change sends to recipients and reports the sent count", async () => {
  await withEnv({ ITX_RESEND_API_KEY: "test-resend-key" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "resend-message-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )) as typeof fetch;
    try {
      const adminClient = buildAdminClient({
        workspace_policies: {
          data: [{ billing_email: "ops@school.edu" }],
          error: null,
        },
        sales_leads: {
          data: [{ reply_email: "billing@district.org" }],
          error: null,
        },
        subprocessor_changes: [
          { data: { id: "change-2" }, error: null },
          { data: { id: "change-2" }, error: null },
        ],
        email_delivery_logs: { data: { id: "log-1" }, error: null },
      });
      const response = await handleSubprocessorsAction(
        contextFor(
          "announce_subprocessor_change",
          { vendor: "Resend", change_type: "added", effective_date: FAR_FUTURE_DATE },
          adminClient,
        ),
      );
      assert(response!.status === 200, "expected 200");
      const body = await response!.json() as Record<string, any>;
      assert(body.recipientsCount === 2, `expected 2 sent, got ${body.recipientsCount}`);
      assert(body.totalTargets === 2, "expected 2 total targets");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("announce_subprocessor_change returns 500 when the final status update fails", async () => {
  await withEnv({ ITX_RESEND_API_KEY: "test-resend-key" }, async () => {
    const adminClient = buildAdminClient({
      workspace_policies: { data: [], error: null },
      sales_leads: { data: [], error: null },
      subprocessor_changes: [
        { data: { id: "change-3" }, error: null },
        { data: null, error: { message: "db down" } },
      ],
    });
    const response = await handleSubprocessorsAction(
      contextFor(
        "announce_subprocessor_change",
        { vendor: "Resend", change_type: "added", effective_date: FAR_FUTURE_DATE },
        adminClient,
      ),
    );
    assert(response!.status === 500, "expected 500");
    const body = await response!.json() as Record<string, unknown>;
    assert(
      body.error ===
        "Notice delivery completed, but its status could not be saved.",
      "expected status-save error",
    );
  });
});

// ── list_subprocessor_notices ────────────────────────────────────────────────

Deno.test("list_subprocessor_notices returns notices on success", async () => {
  const notices = [{ id: "n1", vendor: "Resend", status: "sent" }];
  const adminClient = buildAdminClient({
    subprocessor_changes: { data: notices, error: null },
  });
  const response = await handleSubprocessorsAction(
    contextFor("list_subprocessor_notices", {}, adminClient),
  );
  assert(response!.status === 200, "expected 200");
  const body = await response!.json() as Record<string, any>;
  assert(body.notices.length === 1, "expected one notice");
});

Deno.test("list_subprocessor_notices returns 503 when the table is missing", async () => {
  const adminClient = buildAdminClient({
    subprocessor_changes: { data: null, error: { code: "42P01", message: "missing" } },
  });
  const response = await handleSubprocessorsAction(
    contextFor("list_subprocessor_notices", {}, adminClient),
  );
  assert(response!.status === 503, "expected 503");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error ===
      "Subprocessor changes table not found. Run latest SQL setup.",
    "expected missing-table error",
  );
});

Deno.test("list_subprocessor_notices returns 500 for a generic database error", async () => {
  const adminClient = buildAdminClient({
    subprocessor_changes: { data: null, error: { message: "db down" } },
  });
  const response = await handleSubprocessorsAction(
    contextFor("list_subprocessor_notices", {}, adminClient),
  );
  assert(response!.status === 500, "expected 500");
  const body = await response!.json() as Record<string, unknown>;
  assert(
    body.error === "Failed to fetch subprocessor notices.",
    "expected generic list error",
  );
});
