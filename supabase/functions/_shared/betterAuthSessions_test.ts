import {
  isBetterAuthSessionActive,
  listActiveBetterAuthSessionIds,
} from "./betterAuthSessions.ts";
import type { SupabaseClient } from "../admin-ops/context.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message?: string) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message ?? `Expected ${b} but got ${a}`);
};

type QueryResult = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};

const makeClient = (result: QueryResult) => {
  const from = (_table: string) => {
    const query: Record<string, unknown> = {};
    const chain = (method: string, args: unknown[]) => {
      void method;
      void args;
      return query;
    };
    for (const method of ["select", "eq", "in", "gt"]) {
      query[method] = (...args: unknown[]) => chain(method, args);
    }
    query.maybeSingle = () => Promise.resolve(result);
    query.then = (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected);
    return query;
  };
  return {
    schema: (_schemaName: string) => ({ from }),
  } as unknown as SupabaseClient;
};

const future = "2099-01-01T00:00:00.000Z";
const past = "2020-01-01T00:00:00.000Z";

Deno.test("isBetterAuthSessionActive accepts a live session for the mapped user", async () => {
  const result = await isBetterAuthSessionActive(
    makeClient({ data: { id: "session-1", expiresAt: future }, error: null }),
    "user-1",
    "session-1",
  );
  assertEquals(result, { active: true, relationMissing: false });
});

Deno.test("isBetterAuthSessionActive fails closed for missing or expired sessions", async () => {
  const missing = await isBetterAuthSessionActive(
    makeClient({ data: null, error: null }),
    "user-1",
    "session-1",
  );
  const expired = await isBetterAuthSessionActive(
    makeClient({ data: { id: "session-1", expiresAt: past }, error: null }),
    "user-1",
    "session-1",
  );
  assertEquals(missing, { active: false, relationMissing: false });
  assertEquals(expired, { active: false, relationMissing: false });
});

Deno.test("Better Auth session helpers report an unapplied session relation", async () => {
  const result = await isBetterAuthSessionActive(
    makeClient({
      data: null,
      error: {
        code: "42P01",
        message: 'relation "better_auth.session" does not exist',
      },
    }),
    "user-1",
    "session-1",
  );
  assertEquals(result, { active: false, relationMissing: true });
});

Deno.test("listActiveBetterAuthSessionIds returns only live matching rows", async () => {
  const result = await listActiveBetterAuthSessionIds(
    makeClient({
      data: [
        { id: "session-live", expiresAt: future },
        { id: "session-expired", expiresAt: past },
      ],
      error: null,
    }),
    "user-1",
    ["session-live", "session-expired"],
  );
  assertEquals([...result.sessionIds], ["session-live"]);
  assertEquals(result.relationMissing, false);
});

Deno.test("listActiveBetterAuthSessionIds avoids a query when no registry ids exist", async () => {
  const result = await listActiveBetterAuthSessionIds(makeClient({}), "user-1", []);
  assert(result.sessionIds.size === 0, "expected no active ids");
  assertEquals(result.relationMissing, false);
});
