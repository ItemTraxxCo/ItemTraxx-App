import {
  buildError,
  buildJson,
  buildSessionRateLimitError,
} from "./responses.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};

Deno.test("response builders preserve JSON envelopes, request IDs, and supplied headers", async () => {
  const extraHeaders = new Headers({ "Set-Cookie": "itx_session=token", "x-upstream": "kept" });
  const error = buildError(
    403,
    "Origin not allowed",
    { "Access-Control-Allow-Credentials": "true" },
    "request-error",
    extraHeaders,
  );

  assertEquals(error.status, 403, "error status");
  assertEquals(await error.json(), { error: "Origin not allowed" }, "error envelope");
  assertEquals(error.headers.get("content-type"), "application/json", "error content type");
  assertEquals(error.headers.get("x-request-id"), "request-error", "error request ID");
  assertEquals(error.headers.get("set-cookie"), "itx_session=token", "extra cookie header");
  assertEquals(error.headers.get("x-upstream"), "kept", "extra upstream header");
  assertEquals(error.headers.get("access-control-allow-credentials"), "true", "CORS header");

  const json = buildJson(
    201,
    { ok: true, nested: { value: 1 } },
    { "Access-Control-Allow-Origin": "https://itemtraxx.com" },
    "request-json",
  );
  assertEquals(json.status, 201, "JSON status");
  assertEquals(await json.json(), { ok: true, nested: { value: 1 } }, "JSON envelope");
  assertEquals(json.headers.get("x-request-id"), "request-json", "JSON request ID");
});

Deno.test("response builders clone extra headers and apply canonical precedence", async () => {
  const extraHeaders = new Headers({
    "Content-Type": "text/plain",
    "x-request-id": "stale-request",
    "x-shared": "from-extra",
    "x-extra-only": "preserved",
  });
  const error = buildError(
    409,
    "Already exists",
    {
      "Content-Type": "application/problem+json",
      "x-request-id": "caller-request",
      "x-shared": "from-caller",
    },
    "canonical-request",
    extraHeaders,
  );
  extraHeaders.set("x-extra-only", "mutated-after-build");

  assertEquals(error.status, 409, "error status");
  assertEquals(
    await error.json(),
    { error: "Already exists" },
    "exact error body",
  );
  assertEquals(
    error.headers.get("x-extra-only"),
    "preserved",
    "extra headers are cloned",
  );
  assertEquals(
    error.headers.get("x-shared"),
    "from-caller",
    "caller headers override extras",
  );
  assertEquals(
    error.headers.get("content-type"),
    "application/json",
    "JSON content type is forced",
  );
  assertEquals(
    error.headers.get("x-request-id"),
    "canonical-request",
    "request ID is forced",
  );

  const json = buildJson(
    202,
    { data: ["one", "two"], accepted: true },
    { "x-shared": "from-json-caller" },
    "json-request",
    new Headers({ "x-shared": "from-json-extra" }),
  );
  assertEquals(json.status, 202, "arbitrary JSON status");
  assertEquals(
    await json.json(),
    { data: ["one", "two"], accepted: true },
    "exact arbitrary JSON body",
  );
  assertEquals(
    json.headers.get("x-shared"),
    "from-json-caller",
    "JSON caller precedence",
  );
});

Deno.test("session rate-limit responses preserve status, messages, and retry guidance", async () => {
  const limited = buildSessionRateLimitError("rate_limited", {}, "request-limited");
  assertEquals(limited.status, 429, "limited status");
  assertEquals(limited.headers.get("retry-after"), "60", "retry window");
  assertEquals(await limited.json(), { error: "Too many session requests" }, "limited envelope");

  const unavailable = buildSessionRateLimitError("unavailable", {}, "request-unavailable");
  assertEquals(unavailable.status, 503, "unavailable status");
  assertEquals(unavailable.headers.get("retry-after"), null, "unavailable retry header");
  assertEquals(
    await unavailable.json(),
    { error: "Session protection unavailable" },
    "unavailable envelope",
  );
});
