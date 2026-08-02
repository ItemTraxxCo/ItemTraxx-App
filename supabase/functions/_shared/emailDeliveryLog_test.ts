import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { sendLoggedResendEmail } from "./emailDeliveryLog.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

// ---- mock Supabase admin client ----

type InsertOutcome = { data: { id: string } | null; error: unknown };
type UpdateOutcome = { error: unknown };

class MockAdminClient {
  inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  updates: Array<{ table: string; payload: Record<string, unknown>; id: string }> =
    [];
  private readonly updateQueue: UpdateOutcome[];

  constructor(
    private readonly insertOutcome: InsertOutcome,
    updateOutcomes: UpdateOutcome[] = [{ error: null }],
  ) {
    this.updateQueue = [...updateOutcomes];
  }

  from(table: string) {
    return {
      insert: (payload: Record<string, unknown>) => {
        this.inserts.push({ table, payload });
        return {
          select: (_columns: string) => ({
            single: () => Promise.resolve(this.insertOutcome),
          }),
        };
      },
      update: (payload: Record<string, unknown>) => ({
        eq: (_column: string, id: string) => {
          this.updates.push({ table, payload, id });
          const outcome = this.updateQueue.shift() ?? { error: null };
          return Promise.resolve(outcome);
        },
      }),
    };
  }
}

const asClient = (client: MockAdminClient) =>
  client as unknown as SupabaseClient;

const withStubbedFetch = async (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const BASE_CONTEXT = {
  emailType: "welcome",
  recipientEmail: "person@example.com",
  subject: "Welcome",
};

// ---- happy path ----

Deno.test("sendLoggedResendEmail: successful send inserts a queued row then marks it sent", async () => {
  const client = new MockAdminClient({ data: { id: "log-1" }, error: null });
  let capturedInit: RequestInit | undefined;
  await withStubbedFetch(
    (input, init) => {
      capturedInit = init;
      assert(
        String(input) === "https://api.resend.com/emails",
        "posts to the Resend emails endpoint",
      );
      return Promise.resolve(
        Response.json({ id: "resend-msg-1" }, { status: 200 }),
      );
    },
    async () => {
      const result = await sendLoggedResendEmail(
        asClient(client),
        "api-key-1",
        { to: "person@example.com" },
        BASE_CONTEXT,
      );
      assert(
        (result as { id: string }).id === "resend-msg-1",
        "returns the Resend response body",
      );
    },
  );

  assert(client.inserts.length === 1, "one insert row for the queued log");
  assert(
    client.inserts[0].table === "email_delivery_logs",
    "insert targets email_delivery_logs",
  );
  assert(
    new Headers(capturedInit?.headers).get("authorization") ===
      "Bearer api-key-1",
    "forwards the API key as a bearer token",
  );
  assert(
    new Headers(capturedInit?.headers).get("content-type") ===
      "application/json",
    "sends JSON content type",
  );
  assert(
    capturedInit?.body === JSON.stringify({ to: "person@example.com" }),
    "forwards the Resend payload verbatim",
  );

  assert(client.updates.length === 1, "one update row for the sent status");
  const update = client.updates[0];
  assert(update.id === "log-1", "update targets the inserted row id");
  assert(update.payload.status === "sent", "update marks status sent");
  assert(
    update.payload.provider_message_id === "resend-msg-1",
    "update records the provider message id",
  );
  assert(update.payload.error_message === null, "sent status has no error message");
  assert(
    typeof update.payload.sent_at === "string" &&
      !Number.isNaN(Date.parse(update.payload.sent_at as string)),
    "sent status stamps sent_at",
  );
});

Deno.test("sendLoggedResendEmail: defaults provider to resend when not specified", async () => {
  const client = new MockAdminClient({ data: { id: "log-2" }, error: null });
  await withStubbedFetch(
    () => Promise.resolve(Response.json({ id: "msg" })),
    async () => {
      await sendLoggedResendEmail(
        asClient(client),
        "api-key",
        {},
        BASE_CONTEXT,
      );
    },
  );
  assert(
    client.inserts[0].payload.provider === "resend",
    "provider defaults to resend",
  );
});

Deno.test("sendLoggedResendEmail: uses the provided provider on insert", async () => {
  const client = new MockAdminClient({ data: { id: "log-3" }, error: null });
  await withStubbedFetch(
    () => Promise.resolve(Response.json({ id: "msg" })),
    async () => {
      await sendLoggedResendEmail(
        asClient(client),
        "api-key",
        {},
        { ...BASE_CONTEXT, provider: "postmark" },
      );
    },
  );
  assert(
    client.inserts[0].payload.provider === "postmark",
    "custom provider is preserved",
  );
});

Deno.test("sendLoggedResendEmail: optional context fields default to null on insert", async () => {
  const client = new MockAdminClient({ data: { id: "log-4" }, error: null });
  await withStubbedFetch(
    () => Promise.resolve(Response.json({ id: "msg" })),
    async () => {
      await sendLoggedResendEmail(
        asClient(client),
        "api-key",
        {},
        BASE_CONTEXT,
      );
    },
  );
  const payload = client.inserts[0].payload;
  assert(payload.request_context === null, "request_context defaults null");
  assert(
    payload.triggered_by_user_id === null,
    "triggered_by_user_id defaults null",
  );
  assert(payload.job_id === null, "job_id defaults null");
  assert(payload.workspace_id === null, "workspace_id defaults null");
  assert(payload.metadata === null, "metadata defaults null");
});

Deno.test("sendLoggedResendEmail: optional context fields are passed through when provided", async () => {
  const client = new MockAdminClient({ data: { id: "log-5" }, error: null });
  await withStubbedFetch(
    () => Promise.resolve(Response.json({ id: "msg" })),
    async () => {
      await sendLoggedResendEmail(
        asClient(client),
        "api-key",
        {},
        {
          ...BASE_CONTEXT,
          requestContext: { ip: "203.0.113.1" },
          triggeredByUserId: "user-1",
          jobId: "job-1",
          workspaceId: "ws-1",
          metadata: { campaign: "onboarding" },
        },
      );
    },
  );
  const payload = client.inserts[0].payload;
  assert(
    JSON.stringify(payload.request_context) === JSON.stringify({ ip: "203.0.113.1" }),
    "request_context is preserved",
  );
  assert(payload.triggered_by_user_id === "user-1", "triggered_by_user_id preserved");
  assert(payload.job_id === "job-1", "job_id preserved");
  assert(payload.workspace_id === "ws-1", "workspace_id preserved");
  assert(
    JSON.stringify(payload.metadata) === JSON.stringify({ campaign: "onboarding" }),
    "metadata preserved",
  );
});

// ---- insert failure tolerance ----

Deno.test("sendLoggedResendEmail: continues sending when the initial insert reports an error", async () => {
  const client = new MockAdminClient({
    data: null,
    error: { message: "insert failed" },
  });
  const result = await withResult(client, () =>
    Promise.resolve(Response.json({ id: "msg-ok" })));
  assert(
    (result as { id: string }).id === "msg-ok",
    "send still succeeds without a log row",
  );
  assert(client.updates.length === 0, "no update without a log id");
});

Deno.test("sendLoggedResendEmail: continues sending when insert returns no error and no id", async () => {
  const client = new MockAdminClient({ data: null, error: null });
  const result = await withResult(client, () =>
    Promise.resolve(Response.json({ id: "msg-ok" })));
  assert(
    (result as { id: string }).id === "msg-ok",
    "send still succeeds when the insert silently returns nothing",
  );
  assert(client.updates.length === 0, "no update without a log id");
});

const withResult = (
  client: MockAdminClient,
  handler: () => Promise<Response>,
) => {
  let captured: unknown;
  return withStubbedFetch(handler, async () => {
    captured = await sendLoggedResendEmail(
      asClient(client),
      "api-key",
      {},
      BASE_CONTEXT,
    );
  }).then(() => captured);
};

// ---- upstream failure handling ----

Deno.test("sendLoggedResendEmail: non-ok Resend response marks the log failed twice and throws", async () => {
  const client = new MockAdminClient(
    { data: { id: "log-6" }, error: null },
    [{ error: null }, { error: null }],
  );
  let thrown: Error | null = null;
  await withStubbedFetch(
    () =>
      Promise.resolve(
        Response.json({ message: "Invalid recipient" }, { status: 422 }),
      ),
    async () => {
      try {
        await sendLoggedResendEmail(
          asClient(client),
          "api-key",
          {},
          BASE_CONTEXT,
        );
      } catch (error) {
        thrown = error as Error;
      }
    },
  );
  assert(thrown !== null, "expected the send to throw");
  assert(
    (thrown as unknown as Error).message.includes("Invalid recipient"),
    "thrown error includes the upstream message",
  );
  assert(
    (thrown as unknown as Error).message.includes("422"),
    "thrown error includes the response status",
  );
  // The inner not-ok handler logs a failed status, then the outer catch logs
  // the resulting thrown Error a second time.
  assert(client.updates.length === 2, "failure is logged twice");
  assert(client.updates[0].payload.status === "failed", "first update failed");
  assert(client.updates[1].payload.status === "failed", "second update failed");
});

Deno.test("sendLoggedResendEmail: falls back to a generic message when Resend omits one", async () => {
  const client = new MockAdminClient(
    { data: { id: "log-7" }, error: null },
    [{ error: null }, { error: null }],
  );
  let thrown: Error | null = null;
  await withStubbedFetch(
    () => Promise.resolve(new Response(JSON.stringify({}), { status: 500 })),
    async () => {
      try {
        await sendLoggedResendEmail(
          asClient(client),
          "api-key",
          {},
          BASE_CONTEXT,
        );
      } catch (error) {
        thrown = error as Error;
      }
    },
  );
  assert(thrown !== null, "expected the send to throw");
  assert(
    (thrown as unknown as Error).message.includes("Email send failed: 500"),
    "falls back to the generic status-based message",
  );
});

Deno.test("sendLoggedResendEmail: tolerates a non-JSON Resend response body", async () => {
  const client = new MockAdminClient(
    { data: { id: "log-8" }, error: null },
    [{ error: null }, { error: null }],
  );
  let thrown: Error | null = null;
  await withStubbedFetch(
    () =>
      Promise.resolve(
        new Response("not json", {
          status: 502,
          headers: { "content-type": "text/plain" },
        }),
      ),
    async () => {
      try {
        await sendLoggedResendEmail(
          asClient(client),
          "api-key",
          {},
          BASE_CONTEXT,
        );
      } catch (error) {
        thrown = error as Error;
      }
    },
  );
  assert(thrown !== null, "expected the send to throw even with a bad body");
  assert(
    (thrown as unknown as Error).message.includes("Email send failed: 502"),
    "falls back to the generic message for unparsable bodies",
  );
});

Deno.test("sendLoggedResendEmail: not-ok response with no log id skips both update attempts", async () => {
  const client = new MockAdminClient({ data: null, error: { message: "no row" } });
  let thrown: Error | null = null;
  await withStubbedFetch(
    () => Promise.resolve(new Response(null, { status: 429 })),
    async () => {
      try {
        await sendLoggedResendEmail(
          asClient(client),
          "api-key",
          {},
          BASE_CONTEXT,
        );
      } catch (error) {
        thrown = error as Error;
      }
    },
  );
  assert(thrown !== null, "expected the send to throw");
  assert(client.updates.length === 0, "no updates possible without a log id");
});

Deno.test("sendLoggedResendEmail: rethrows and logs once when the network request itself throws", async () => {
  const client = new MockAdminClient(
    { data: { id: "log-9" }, error: null },
    [{ error: null }],
  );
  const networkError = new Error("network down");
  let thrown: Error | null = null;
  await withStubbedFetch(
    () => Promise.reject(networkError),
    async () => {
      try {
        await sendLoggedResendEmail(
          asClient(client),
          "api-key",
          {},
          BASE_CONTEXT,
        );
      } catch (error) {
        thrown = error as Error;
      }
    },
  );
  assert(thrown === networkError, "the original network error is rethrown");
  assert(client.updates.length === 1, "one failure log for the network error");
  assert(
    client.updates[0].payload.error_message === "network down",
    "logged error message matches the thrown error",
  );
});

Deno.test("sendLoggedResendEmail: a network throw with no log id skips logging entirely", async () => {
  const client = new MockAdminClient({ data: null, error: null });
  const networkError = new Error("network down");
  let thrown: Error | null = null;
  await withStubbedFetch(
    () => Promise.reject(networkError),
    async () => {
      try {
        await sendLoggedResendEmail(
          asClient(client),
          "api-key",
          {},
          BASE_CONTEXT,
        );
      } catch (error) {
        thrown = error as Error;
      }
    },
  );
  assert(thrown === networkError, "the original network error is rethrown");
  assert(client.updates.length === 0, "no updates possible without a log id");
});

Deno.test("sendLoggedResendEmail: swallows a secondary log-update failure and still rethrows the original error", async () => {
  const client = new MockAdminClient(
    { data: { id: "log-10" }, error: null },
    [{ error: { message: "db unavailable" } }],
  );
  const networkError = new Error("network down");
  let thrown: Error | null = null;
  await withStubbedFetch(
    () => Promise.reject(networkError),
    async () => {
      try {
        await sendLoggedResendEmail(
          asClient(client),
          "api-key",
          {},
          BASE_CONTEXT,
        );
      } catch (error) {
        thrown = error as Error;
      }
    },
  );
  assert(
    thrown === networkError,
    "the original send error surfaces even though the secondary log update failed",
  );
});

Deno.test("sendLoggedResendEmail: a non-Error thrown value falls back to a generic logged message", async () => {
  const client = new MockAdminClient(
    { data: { id: "log-11" }, error: null },
    [{ error: null }],
  );
  let thrown: unknown = null;
  await withStubbedFetch(
    () => Promise.reject("string rejection"),
    async () => {
      try {
        await sendLoggedResendEmail(
          asClient(client),
          "api-key",
          {},
          BASE_CONTEXT,
        );
      } catch (error) {
        thrown = error;
      }
    },
  );
  assert(thrown === "string rejection", "the original rejection value is rethrown");
  assert(
    client.updates[0].payload.error_message === "Email send failed.",
    "non-Error rejections log the generic fallback message",
  );
});

// ---- text trimming ----

Deno.test("sendLoggedResendEmail: truncates an overlong provider message id to 255 characters", async () => {
  const client = new MockAdminClient({ data: { id: "log-12" }, error: null });
  const longId = "m".repeat(300);
  await withStubbedFetch(
    () => Promise.resolve(Response.json({ id: longId })),
    async () => {
      await sendLoggedResendEmail(
        asClient(client),
        "api-key",
        {},
        BASE_CONTEXT,
      );
    },
  );
  const providerMessageId = client.updates[0].payload
    .provider_message_id as string;
  assert(providerMessageId.length === 255, "provider message id capped at 255");
  assert(providerMessageId === longId.slice(0, 255), "capped value is a prefix");
});

Deno.test("sendLoggedResendEmail: truncates an overlong upstream error message to 2000 characters", async () => {
  const client = new MockAdminClient(
    { data: { id: "log-13" }, error: null },
    [{ error: null }, { error: null }],
  );
  const longMessage = "e".repeat(2500);
  await withStubbedFetch(
    () =>
      Promise.resolve(
        Response.json({ message: longMessage }, { status: 400 }),
      ),
    async () => {
      try {
        await sendLoggedResendEmail(
          asClient(client),
          "api-key",
          {},
          BASE_CONTEXT,
        );
      } catch {
        // expected -- asserting on the logged payload below
      }
    },
  );
  const errorMessage = client.updates[0].payload.error_message as string;
  assert(errorMessage.length === 2000, "error message capped at 2000 characters");
});

Deno.test("sendLoggedResendEmail: whitespace-only upstream messages are logged as null", async () => {
  const client = new MockAdminClient(
    { data: { id: "log-14" }, error: null },
    [{ error: null }, { error: null }],
  );
  await withStubbedFetch(
    () =>
      Promise.resolve(Response.json({ message: "   " }, { status: 400 })),
    async () => {
      try {
        await sendLoggedResendEmail(
          asClient(client),
          "api-key",
          {},
          BASE_CONTEXT,
        );
      } catch {
        // expected -- asserting on the logged payload below
      }
    },
  );
  assert(
    client.updates[0].payload.error_message === null,
    "whitespace-only messages normalize to null",
  );
});

Deno.test("sendLoggedResendEmail: a non-string provider message id logs as null", async () => {
  const client = new MockAdminClient({ data: { id: "log-15" }, error: null });
  await withStubbedFetch(
    () => Promise.resolve(Response.json({ id: 12345 })),
    async () => {
      await sendLoggedResendEmail(
        asClient(client),
        "api-key",
        {},
        BASE_CONTEXT,
      );
    },
  );
  assert(
    client.updates[0].payload.provider_message_id === null,
    "non-string ids are normalized to null",
  );
});
