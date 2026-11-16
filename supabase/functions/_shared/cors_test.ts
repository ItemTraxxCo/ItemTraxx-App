import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isAllowedOrigin,
  parseAllowedOrigins,
  resolveCorsHeaders,
} from "./cors.ts";

Deno.test("parseAllowedOrigins trims blank entries", () => {
  assertEquals(
    parseAllowedOrigins(" https://app.itemtraxx.com, ,https://itemtraxx.com "),
    ["https://app.itemtraxx.com", "https://itemtraxx.com"],
  );
});

Deno.test("isAllowedOrigin requires exact configured origins", () => {
  const allowedOrigins = parseAllowedOrigins(
    "https://app.itemtraxx.com,https://staging.itemtraxx.com",
  );

  assert(isAllowedOrigin("https://app.itemtraxx.com", allowedOrigins));
  assert(isAllowedOrigin("https://staging.itemtraxx.com", allowedOrigins));
  const demoOrigin = parseAllowedOrigins("https://itxdemo.app.itemtraxx.com");
  assert(isAllowedOrigin("https://itxdemo.app.itemtraxx.com", demoOrigin));
});

Deno.test("isAllowedOrigin does not expand wildcard origin patterns", () => {
  const allowedOrigins = parseAllowedOrigins("https://*.itemtraxx.com");

  assert(!isAllowedOrigin("https://app.itemtraxx.com", allowedOrigins));
  assert(
    !isAllowedOrigin("https://itemtraxx.com.attacker.com", allowedOrigins),
  );
  assert(
    !isAllowedOrigin("https://evil.itemtraxx.com.attacker.com", allowedOrigins),
  );
});

Deno.test("isAllowedOrigin requires provider-managed workspace app origins", () => {
  const workspaceOrigin = "https://new-workspace.app.itemtraxx.com";
  assert(!isAllowedOrigin(workspaceOrigin, []));
  assert(isAllowedOrigin(workspaceOrigin, [workspaceOrigin]));
  assert(!isAllowedOrigin("http://new-workspace.app.itemtraxx.com", []));
  assert(!isAllowedOrigin("https://app.app.itemtraxx.com", []));
  assert(!isAllowedOrigin("https://two.levels.app.itemtraxx.com", []));
  assert(!isAllowedOrigin("https://workspace.app.itemtraxx.com.attacker.com", []));
  for (const reserved of ["itxdemo", "pentest", "pentest2", "testdist"]) {
    assert(!isAllowedOrigin(`https://${reserved}.app.itemtraxx.com`, []));
  }
});

const BASE_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
const ALLOWED = "https://app.itemtraxx.com,https://itemtraxx.com";
const ENDPOINT = "https://edge.itemtraxx.com/functions/example";

const request = (method: string, origin?: string) =>
  new Request(ENDPOINT, {
    method,
    headers: origin === undefined ? {} : { Origin: origin },
  });

Deno.test("resolveCorsHeaders echoes an exactly allowlisted origin", () => {
  const result = resolveCorsHeaders(
    request("POST", "https://app.itemtraxx.com"),
    BASE_HEADERS,
    ALLOWED,
  );

  assertEquals(result.hasOrigin, true);
  assertEquals(result.originAllowed, true);
  assertEquals(result.headers, {
    ...BASE_HEADERS,
    "Access-Control-Allow-Origin": "https://app.itemtraxx.com",
  });
});

Deno.test("resolveCorsHeaders rejects unlisted origins without echoing them", () => {
  for (
    const origin of [
      "https://attacker.example",
      "https://app.itemtraxx.com.attacker.example",
      "http://app.itemtraxx.com",
      "https://app.itemtraxx.com:8443",
      "https://APP.itemtraxx.com",
      "https://app.itemtraxx.com/",
      "null",
      "*",
    ]
  ) {
    const result = resolveCorsHeaders(
      request("POST", origin),
      BASE_HEADERS,
      ALLOWED,
    );

    assertEquals(result.hasOrigin, true, origin);
    assertEquals(result.originAllowed, false, origin);
    assert(!("Access-Control-Allow-Origin" in result.headers), origin);
    assertEquals(result.headers, BASE_HEADERS, origin);
  }
});

Deno.test("resolveCorsHeaders allows requests without an Origin and emits no allow-origin", () => {
  for (const req of [request("POST"), request("POST", "")]) {
    const result = resolveCorsHeaders(req, BASE_HEADERS, ALLOWED);

    assertEquals(result.hasOrigin, false);
    assertEquals(result.originAllowed, true);
    assert(!("Access-Control-Allow-Origin" in result.headers));
  }
});

Deno.test("resolveCorsHeaders fails closed for browser origins when the allowlist is empty or unset", () => {
  for (const allowlist of ["", " , ", null]) {
    const result = resolveCorsHeaders(
      request("POST", "https://app.itemtraxx.com"),
      BASE_HEADERS,
      allowlist,
    );

    assertEquals(result.originAllowed, false);
    assert(!("Access-Control-Allow-Origin" in result.headers));
  }
});

Deno.test("resolveCorsHeaders never emits a wildcard or credentials header", () => {
  const result = resolveCorsHeaders(
    request("POST", "https://app.itemtraxx.com"),
    BASE_HEADERS,
    "*,https://app.itemtraxx.com",
  );

  assertEquals(
    result.headers["Access-Control-Allow-Origin"],
    "https://app.itemtraxx.com",
  );
  assert(!("Access-Control-Allow-Credentials" in result.headers));
});

Deno.test("resolveCorsHeaders preserves per-function base headers", () => {
  const statusHeaders = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-request-id, traceparent, tracestate",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
  const result = resolveCorsHeaders(
    request("GET", "https://itemtraxx.com"),
    statusHeaders,
    ALLOWED,
  );

  assertEquals(result.headers["Access-Control-Allow-Methods"], "GET, OPTIONS");
  assertEquals(
    result.headers["Access-Control-Allow-Headers"],
    statusHeaders["Access-Control-Allow-Headers"],
  );
  assertEquals(result.headers.Vary, "Origin");
});

Deno.test("resolveCorsHeaders returns a fresh headers object and leaves the base untouched", () => {
  const snapshot = { ...BASE_HEADERS };
  const allowed = resolveCorsHeaders(
    request("POST", "https://app.itemtraxx.com"),
    BASE_HEADERS,
    ALLOWED,
  );
  const noOrigin = resolveCorsHeaders(request("POST"), BASE_HEADERS, ALLOWED);

  assert(allowed.headers !== BASE_HEADERS);
  assert(noOrigin.headers !== BASE_HEADERS);
  (noOrigin.headers as Record<string, string>)["X-Extra"] = "1";
  assertEquals(BASE_HEADERS, snapshot);
});

Deno.test("resolveCorsHeaders gives an allowed OPTIONS preflight everything the browser checks", () => {
  const result = resolveCorsHeaders(
    request("OPTIONS", "https://app.itemtraxx.com"),
    BASE_HEADERS,
    ALLOWED,
  );
  const response = new Response("ok", { headers: result.headers });

  assertEquals(result.originAllowed, true);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://app.itemtraxx.com",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "POST, OPTIONS",
  );
  assert(
    response.headers.get("Access-Control-Allow-Headers")?.includes(
      "content-type",
    ),
  );
  assertEquals(response.headers.get("Vary"), "Origin");
});

Deno.test("resolveCorsHeaders gives a disallowed OPTIONS preflight no allow-origin", () => {
  const result = resolveCorsHeaders(
    request("OPTIONS", "https://attacker.example"),
    BASE_HEADERS,
    ALLOWED,
  );
  const response = new Response("Origin not allowed", {
    status: 403,
    headers: result.headers,
  });

  assertEquals(result.originAllowed, false);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(response.headers.get("Vary"), "Origin");
});
