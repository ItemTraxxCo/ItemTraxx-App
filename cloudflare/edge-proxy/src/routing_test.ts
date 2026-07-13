import {
  getFunctionName,
  getRpcFunctionName,
  getSessionAction,
  isAllowedRpcProxyPath,
  isBlockedRpcProxyPath,
  isRestProxyPath,
  isRpcProxyPath,
  isUnauthorizedRpcProxyPath,
} from "./routing.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
};

Deno.test("function and session parsers accept only exact unencoded route shapes", () => {
  assertEquals(
    getFunctionName("/functions/system-status"),
    "system-status",
    "function route",
  );
  assertEquals(
    getFunctionName("/functions/system-status/"),
    "",
    "function trailing slash",
  );
  assertEquals(
    getFunctionName("/functions/%73ystem-status"),
    "",
    "encoded function name",
  );
  assertEquals(
    getFunctionName("//functions/system-status"),
    "",
    "function leading slash shape",
  );
  assertEquals(
    getFunctionName("/functions//system-status"),
    "",
    "function empty segment",
  );

  assertEquals(
    getSessionAction("/auth/session/exchange"),
    "exchange",
    "session route",
  );
  assertEquals(
    getSessionAction("/auth/session/exchange/"),
    "",
    "session trailing slash",
  );
  assertEquals(
    getSessionAction("/auth/session/%65xchange"),
    "",
    "encoded session action",
  );
  assertEquals(
    getSessionAction("/auth//session/exchange"),
    "",
    "session empty segment",
  );
});

Deno.test("REST and RPC path family detection preserves exact prefixes", () => {
  assert(isRestProxyPath("/rest/v1/profiles"), "REST child path");
  assert(!isRestProxyPath("/rest/v1"), "bare REST prefix");
  assert(!isRestProxyPath("/rest/v10/profiles"), "REST lookalike");
  assert(isRpcProxyPath("/rpc"), "bare RPC path");
  assert(isRpcProxyPath("/rpc/consume_rate_limit"), "RPC child path");
  assert(!isRpcProxyPath("/rpc-lookalike"), "RPC lookalike");
});

Deno.test("RPC allowlist accepts only consume_rate_limit in exact direct or REST shapes", () => {
  for (
    const path of ["/rpc/consume_rate_limit", "/rest/v1/rpc/consume_rate_limit"]
  ) {
    assertEquals(
      getRpcFunctionName(path),
      "consume_rate_limit",
      `RPC function for ${path}`,
    );
    assert(isAllowedRpcProxyPath(path), `allowlisted RPC rejected: ${path}`);
    assert(!isBlockedRpcProxyPath(path), `allowlisted RPC blocked: ${path}`);
  }

  for (
    const path of [
      "/rpc",
      "/rpc/consume_rate_limit/",
      "/rpc/%63onsume_rate_limit",
      "/rest/v1/rpc",
      "/rest/v1/rpc/consume_rate_limit/",
      "/rest/v1/rpc/%63onsume_rate_limit",
    ]
  ) {
    assertEquals(
      getRpcFunctionName(path),
      "",
      `blocked RPC parser result for ${path}`,
    );
    assert(
      !isAllowedRpcProxyPath(path),
      `blocked RPC was allowlisted: ${path}`,
    );
    assert(isBlockedRpcProxyPath(path), `RPC path was not blocked: ${path}`);
  }

  for (
    const [path, functionName] of [
      ["/rpc/consume_rate_limit_prelogin", "consume_rate_limit_prelogin"],
      ["/rest/v1/rpc/run_data_retention", "run_data_retention"],
    ]
  ) {
    assertEquals(
      getRpcFunctionName(path),
      functionName,
      `disallowed RPC parser result for ${path}`,
    );
    assert(
      !isAllowedRpcProxyPath(path),
      `disallowed RPC was allowlisted: ${path}`,
    );
    assert(
      isBlockedRpcProxyPath(path),
      `disallowed RPC path was not blocked: ${path}`,
    );
  }
});

Deno.test("RPC auth requirement applies to direct and REST RPC path families", () => {
  for (
    const path of [
      "/rpc/consume_rate_limit",
      "/rest/v1/rpc/consume_rate_limit",
      "/rpc/run_data_retention",
    ]
  ) {
    assert(
      isUnauthorizedRpcProxyPath(path, false),
      `unauthenticated RPC accepted: ${path}`,
    );
    assert(
      !isUnauthorizedRpcProxyPath(path, true),
      `authenticated RPC rejected: ${path}`,
    );
  }
  assert(
    !isUnauthorizedRpcProxyPath("/rest/v1/profiles", false),
    "non-RPC path required RPC auth",
  );
});

Deno.test("canonicalizable RPC prefixes fail closed before generic REST proxying", () => {
  const canonicalizableRpcPaths = [
    "/rest/v1/%72pc/run_data_retention",
    "/rest/v1/rpc%2Frun_data_retention",
    "/rest/v1//rpc/run_data_retention",
    "/rest/v1/%2572pc/run_data_retention",
    "/rest/v1/r%2570c/run_data_retention",
    "/rest/v1/rpc%5Crun_data_retention",
    "/rest/v1/profiles/%252e%252e/rpc/run_data_retention",
    "/r%70c/run_data_retention",
  ];

  for (const path of canonicalizableRpcPaths) {
    assert(
      isRestProxyPath(path) || path.startsWith("/r"),
      `fixture must enter a proxy family: ${path}`,
    );
    assert(
      !isAllowedRpcProxyPath(path),
      `canonicalized RPC was allowlisted: ${path}`,
    );
    assert(
      isBlockedRpcProxyPath(path),
      `canonicalized RPC was not blocked: ${path}`,
    );
    assert(
      isUnauthorizedRpcProxyPath(path, false),
      `canonicalized RPC skipped caller auth: ${path}`,
    );
  }
});

Deno.test("encoded variants of the allowed RPC remain blocked; only the literal route is allowed", () => {
  const encodedAllowedVariants = [
    "/rest/v1/%72pc/consume_rate_limit",
    "/rest/v1/rpc%2Fconsume_rate_limit",
    "/rest/v1/rpc/%63onsume_rate_limit",
    "/rest/v1/%2572pc/consume_rate_limit",
    "/rpc/%63onsume_rate_limit",
  ];

  for (const path of encodedAllowedVariants) {
    assert(
      !isAllowedRpcProxyPath(path),
      `encoded allowed RPC variant was allowlisted: ${path}`,
    );
    assert(
      isBlockedRpcProxyPath(path),
      `encoded allowed RPC variant was not blocked: ${path}`,
    );
  }
  assert(
    isAllowedRpcProxyPath("/rest/v1/rpc/consume_rate_limit"),
    "literal REST RPC should stay allowed",
  );
});

Deno.test("malformed RPC-like encoding fails closed without blocking normal REST paths", () => {
  for (
    const path of [
      "/rest/v1/%72pc%ZZ/run_data_retention",
      "/rest/v1/rpc/%ZZ",
      "/%72pc%ZZ/run_data_retention",
    ]
  ) {
    assert(
      isBlockedRpcProxyPath(path),
      `malformed RPC-like path was not blocked: ${path}`,
    );
  }

  for (
    const path of [
      "/rest/v1/profiles",
      "/rest/v1/profiles/user%2Fid",
      "/rest/v1/rpc_logs",
      "/rest/v1//profiles",
    ]
  ) {
    assert(
      !isBlockedRpcProxyPath(path),
      `normal REST path was blocked: ${path}`,
    );
  }
});

Deno.test("deep percent nesting fails closed within a bounded routing budget", () => {
  let encodedRpc = "%72pc";
  for (let depth = 0; depth < 10_000; depth += 1) {
    encodedRpc = encodedRpc.replaceAll("%", "%25");
  }
  const path = `/rest/v1/${encodedRpc}/run_data_retention`;

  const startedAt = performance.now();
  const blocked = isBlockedRpcProxyPath(path);
  const elapsedMs = performance.now() - startedAt;

  assert(blocked, "deeply nested RPC encoding must fail closed");
  assert(
    elapsedMs < 100,
    `deeply nested RPC detection exceeded its 100ms budget: ${
      elapsedMs.toFixed(1)
    }ms`,
  );
});
