import {
  isAllowedOrigin,
  isLocalhostOrigin,
  parseCsv,
  resolveRequestOrigin,
  withCorsHeaders,
} from "./cors.ts";
import { DEFAULT_ALLOWED_ORIGINS } from "./constants.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

Deno.test("CORS CSV and exact-origin checks do not expand wildcard or lookalike origins", () => {
  const allowed = parseCsv(
    " https://itemtraxx.com, ,https://app.itemtraxx.com ",
  );
  assertEquals(
    allowed,
    ["https://itemtraxx.com", "https://app.itemtraxx.com"],
    "parsed origins",
  );
  assert(
    isAllowedOrigin("https://itemtraxx.com", allowed, {} as Env),
    "exact origin should pass",
  );
  assert(
    !isAllowedOrigin("https://www.itemtraxx.com", allowed, {} as Env),
    "unlisted origin should fail",
  );
  assert(
    !isAllowedOrigin("https://evil.itemtraxx.com.attacker.com", [
      "https://*.itemtraxx.com",
    ], {} as Env),
    "lookalike origin should fail",
  );
  assert(
    !isAllowedOrigin("https://district.itemtraxx.com", [
      "https://*.itemtraxx.com",
    ], {} as Env),
    "wildcard origin should not expand",
  );
  assert(
    !isAllowedOrigin(null, allowed, {} as Env),
    "missing origin should not be explicitly allowed",
  );
});

Deno.test("localhost origins require the explicit trust flag", () => {
  for (
    const origin of [
      "http://localhost:4173",
      "https://127.0.0.1:4173",
      "http://0.0.0.0:4173",
    ]
  ) {
    assert(isLocalhostOrigin(origin), `expected local origin: ${origin}`);
    assert(
      !isAllowedOrigin(origin, [], {} as Env),
      `local origin trusted without flag: ${origin}`,
    );
    assert(
      isAllowedOrigin(origin, [], { TRUST_LOCAL_ORIGINS: " TrUe " } as Env),
      `local origin rejected with flag: ${origin}`,
    );
  }
  assert(
    !isLocalhostOrigin("https://localhost.attacker.com"),
    "lookalike localhost should fail",
  );
  assert(!isLocalhostOrigin("not a URL"), "invalid localhost URL should fail");
});

Deno.test("production workspace app origins are allowed without per-workspace configuration", () => {
  for (const origin of [
    "https://new-workspace.app.itemtraxx.com",
  ]) {
    assert(
      isAllowedOrigin(origin, [], {} as Env),
      `workspace app origin should pass: ${origin}`,
    );
  }
  for (const origin of [
    "http://itxdemo.app.itemtraxx.com",
    "https://app.itemtraxx.com",
    "https://app.app.itemtraxx.com",
    "https://itxdemo.app.itemtraxx.com",
    "https://pentest.app.itemtraxx.com",
    "https://pentest2.app.itemtraxx.com",
    "https://testdist.app.itemtraxx.com",
    "https://testtenant-15da6e97.app.itemtraxx.com",
    "https://evil.app.itemtraxx.com.attacker.com",
    "https://two.levels.app.itemtraxx.com",
  ]) {
    assert(
      !isAllowedOrigin(origin, [], {} as Env),
      `invalid workspace app origin should fail: ${origin}`,
    );
  }
});

Deno.test("the default production allowlist keeps required surfaces and excludes non-production hosts", () => {
  for (const origin of [
    "https://itemtraxx.com",
    "https://www.itemtraxx.com",
    "https://app.itemtraxx.com",
    "https://internal.itemtraxx.com",
    "https://status.itemtraxx.com",
    "https://preview.itemtraxx.com",
    "https://staging.itemtraxx.com",
    "https://itxdemo.app.itemtraxx.com",
  ]) {
    assert(
      DEFAULT_ALLOWED_ORIGINS.includes(origin),
      `required production origin missing: ${origin}`,
    );
  }
  for (const origin of [
    "https://pentest.app.itemtraxx.com",
    "https://testdist.app.itemtraxx.com",
    "https://dennis-dev.itemtraxx.com",
    "https://leo-dev.itemtraxx.com",
    "https://dev.itemtraxx.com",
  ]) {
    assert(
      !DEFAULT_ALLOWED_ORIGINS.includes(origin),
      `non-production origin remained in default allowlist: ${origin}`,
    );
  }
});

Deno.test("CORS headers preserve the exact security set and reflect only allowed origins", () => {
  const origin = "https://itemtraxx.com";
  const allowed = withCorsHeaders(origin, [origin], {} as Env);
  assert(allowed.originAllowed, "exact origin should be marked allowed");
  assertEquals(
    allowed.headers["Access-Control-Allow-Origin"],
    origin,
    "reflected origin",
  );
  assertEquals(
    allowed.headers["Access-Control-Allow-Credentials"],
    "true",
    "credentials header",
  );
  assertEquals(
    allowed.headers["Access-Control-Allow-Methods"],
    "GET, POST, OPTIONS",
    "methods header",
  );
  assertEquals(
    allowed.headers["Access-Control-Expose-Headers"],
    "content-range, content-profile, x-request-id",
    "exposed headers",
  );
  assertEquals(
    allowed.headers["Access-Control-Allow-Headers"],
    "authorization, x-client-info, apikey, content-type, x-request-id, prefer, x-itx-session-request, x-itx-data-request",
    "allowed headers",
  );
  assertEquals(allowed.headers["Vary"], "Origin", "vary header");
  assertEquals(
    allowed.headers["Strict-Transport-Security"],
    "max-age=31536000; includeSubDomains",
    "HSTS",
  );
  assertEquals(
    allowed.headers["Content-Security-Policy"],
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none';",
    "content security policy",
  );
  assertEquals(
    allowed.headers["Referrer-Policy"],
    "strict-origin-when-cross-origin",
    "referrer policy",
  );
  assertEquals(
    allowed.headers["X-Content-Type-Options"],
    "nosniff",
    "content type protection",
  );
  assertEquals(allowed.headers["X-Frame-Options"], "DENY", "frame protection");
  assertEquals(
    allowed.headers["Permissions-Policy"],
    "camera=(), microphone=(), geolocation=()",
    "permissions policy",
  );

  const blocked = withCorsHeaders(
    "https://attacker.example",
    [origin],
    {} as Env,
  );
  assert(!blocked.originAllowed, "unlisted origin should be blocked");
  assertEquals(
    blocked.headers["Access-Control-Allow-Origin"],
    undefined,
    "blocked origin reflection",
  );

  const missing = withCorsHeaders(null, [origin], {} as Env);
  assert(
    missing.originAllowed,
    "missing origin preserves non-browser allowance",
  );
  assertEquals(
    missing.headers["Access-Control-Allow-Origin"],
    undefined,
    "missing origin reflection",
  );
});

Deno.test("request origin resolution remains a direct Origin-header read", () => {
  assertEquals(
    resolveRequestOrigin(
      new Request("https://edge.itemtraxx.com", {
        headers: { Origin: "https://itemtraxx.com" },
      }),
    ),
    "https://itemtraxx.com",
    "request origin",
  );
  assertEquals(
    resolveRequestOrigin(new Request("https://edge.itemtraxx.com")),
    null,
    "missing request origin",
  );
});
