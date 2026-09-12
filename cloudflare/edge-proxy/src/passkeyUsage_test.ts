import { recordPasskeyUsage } from "./passkeyUsage.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message?: string) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message ?? `Expected ${b} but got ${a}`);
};

Deno.test("recordPasskeyUsage updates the matching credential with a timestamp", async () => {
  const calls: unknown[] = [];
  const now = new Date("2026-09-12T12:00:00.000Z");
  const recorded = await recordPasskeyUsage({
    credentialId: "  credential-1  ",
    now,
    adapter: {
      update: async (args) => {
        calls.push(args);
      },
    },
    logger: { error: () => {} },
  });

  assertEquals(recorded, true);
  assertEquals(calls, [{
    model: "passkey",
    where: [{ field: "credentialID", value: "credential-1" }],
    update: { lastUsedAt: now },
  }]);
});

Deno.test("recordPasskeyUsage does not fail authentication when the metadata write fails", async () => {
  const errors: unknown[] = [];
  const recorded = await recordPasskeyUsage({
    credentialId: "credential-1",
    adapter: {
      update: async () => {
        throw new Error("column unavailable");
      },
    },
    logger: { error: (...args) => errors.push(args) },
  });

  assertEquals(recorded, false);
  assert(errors.length === 1, "expected one logged metadata error");
  assertEquals((errors[0] as unknown[])[0], "Unable to record passkey usage");
});

Deno.test("recordPasskeyUsage ignores an empty credential id", async () => {
  let updates = 0;
  const recorded = await recordPasskeyUsage({
    credentialId: "   ",
    adapter: {
      update: async () => {
        updates += 1;
      },
    },
    logger: { error: () => {} },
  });

  assertEquals(recorded, false);
  assertEquals(updates, 0);
});
