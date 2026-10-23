import { enforcePublicRequestLimit } from "./publicRequestRateLimit.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

Deno.test("public admission keys only on the Cloudflare client IP", async () => {
  let key = "";
  const result = await enforcePublicRequestLimit(
    {
      limit: async ({ key: received }) => {
        key = received;
        return { success: true };
      },
    },
    new Request(
      "https://edge.itemtraxx.com/functions/v1/contact-support-submit",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.8",
          "x-forwarded-for": "198.51.100.1",
          "user-agent": "attacker-controlled",
        },
      },
    ),
    "contact-support-submit",
  );

  assertEquals(result, { allowed: true }, "request is admitted");
  assertEquals(key, "contact-support-submit:203.0.113.8", "stable limiter key");
});

Deno.test("public admission blocks exhausted and unavailable bindings", async () => {
  const request = new Request(
    "https://edge.itemtraxx.com/functions/v1/contact-support-submit",
    {
      method: "POST",
    },
  );
  assertEquals(
    await enforcePublicRequestLimit(
      { limit: async () => ({ success: false }) },
      request,
      "support",
    ),
    { allowed: false },
    "over-budget requests are rejected",
  );
  assertEquals(
    await enforcePublicRequestLimit(undefined, request, "support"),
    { allowed: false, unavailable: true },
    "missing bindings fail closed",
  );
  assertEquals(
    await enforcePublicRequestLimit(
      {
        limit: async () => {
          throw new Error("binding failed");
        },
      },
      request,
      "support",
    ),
    { allowed: false, unavailable: true },
    "binding failures fail closed",
  );
});
