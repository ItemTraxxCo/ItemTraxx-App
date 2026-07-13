import {
  hasRpcCallerAuth,
  sanitizeRequestHeaders,
  sanitizeUpstreamHeaders,
} from "./requestHeaders.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

Deno.test("caller auth accepts an incoming bearer or either session cookie", () => {
  const blank = new Request("https://edge.itemtraxx.com");
  assertEquals(
    hasRpcCallerAuth(blank, { accessToken: null, refreshToken: null }),
    false,
    "missing auth",
  );
  assertEquals(
    hasRpcCallerAuth(blank, { accessToken: "access", refreshToken: null }),
    true,
    "access cookie",
  );
  assertEquals(
    hasRpcCallerAuth(blank, { accessToken: null, refreshToken: "refresh" }),
    true,
    "refresh cookie",
  );
  assertEquals(
    hasRpcCallerAuth(
      new Request("https://edge.itemtraxx.com", {
        headers: { authorization: " Bearer token " },
      }),
      {
        accessToken: null,
        refreshToken: null,
      },
    ),
    true,
    "authorization header",
  );
});

Deno.test("function request headers preserve the allowlist, geo bounds, and super-ops user JWT", () => {
  const request = new Request(
    "https://edge.itemtraxx.com/functions/super-ops",
    {
      headers: {
        "aikido-scan-agent": "scanner",
        "cf-connecting-ip": "203.0.113.42",
        "content-type": "application/json-patch+json",
        "user-agent": "fixture-agent",
        "x-client-info": "fixture-client",
        "x-forwarded-for": "198.51.100.10",
        "x-secret": "must-not-forward",
      },
    },
  ) as Request & { cf?: { city?: string; region?: string; country?: string } };
  request.cf = {
    city: ` ${"c".repeat(100)} `,
    region: " California ",
    country: " US ",
  };
  const headers = sanitizeRequestHeaders(
    request,
    "anon",
    "request-1",
    "super-ops",
    "session-token",
  );
  assertEquals(
    headers.get("authorization"),
    "Bearer session-token",
    "authorization",
  );
  assertEquals(
    headers.get("x-itx-user-jwt"),
    "Bearer session-token",
    "super user JWT",
  );
  assertEquals(
    headers.get("content-type"),
    "application/json-patch+json",
    "content type",
  );
  assertEquals(headers.get("x-client-info"), "fixture-client", "client info");
  assertEquals(headers.get("user-agent"), "fixture-agent", "user agent");
  assertEquals(headers.get("aikido-scan-agent"), "scanner", "scan agent");
  assertEquals(
    headers.get("x-forwarded-for"),
    "198.51.100.10",
    "forwarded for",
  );
  assertEquals(
    headers.get("cf-connecting-ip"),
    "203.0.113.42",
    "connecting IP",
  );
  assertEquals(headers.get("x-itx-geo-city"), "c".repeat(80), "bounded city");
  assertEquals(headers.get("x-itx-geo-region"), "California", "region");
  assertEquals(headers.get("x-itx-geo-country"), "US", "country");
  assertEquals(headers.get("x-secret"), null, "unlisted header");
});

Deno.test("Data API request headers preserve only the supported upstream set", () => {
  const request = new Request("https://edge.itemtraxx.com/rest/v1/items", {
    headers: {
      accept: "application/json",
      prefer: "return=representation",
      range: "0-9",
      "content-type": "application/json",
      "x-secret": "must-not-forward",
    },
  });
  const headers = sanitizeUpstreamHeaders(
    request,
    "anon",
    "request-2",
    "session-token",
  );
  assertEquals(Object.fromEntries(headers.entries()), {
    accept: "application/json",
    apikey: "anon",
    authorization: "Bearer session-token",
    "content-type": "application/json",
    prefer: "return=representation",
    range: "0-9",
    "x-request-id": "request-2",
  }, "Data API headers");
});
