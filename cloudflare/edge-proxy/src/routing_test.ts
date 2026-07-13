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
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
};

Deno.test("function and session parsers accept only exact unencoded route shapes", () => {
  assertEquals(getFunctionName("/functions/system-status"), "system-status", "function route");
  assertEquals(getFunctionName("/functions/system-status/"), "", "function trailing slash");
  assertEquals(getFunctionName("/functions/%73ystem-status"), "", "encoded function name");
  assertEquals(getFunctionName("//functions/system-status"), "", "function leading slash shape");
  assertEquals(getFunctionName("/functions//system-status"), "", "function empty segment");

  assertEquals(getSessionAction("/auth/session/exchange"), "exchange", "session route");
  assertEquals(getSessionAction("/auth/session/exchange/"), "", "session trailing slash");
  assertEquals(getSessionAction("/auth/session/%65xchange"), "", "encoded session action");
  assertEquals(getSessionAction("/auth//session/exchange"), "", "session empty segment");
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
  for (const path of ["/rpc/consume_rate_limit", "/rest/v1/rpc/consume_rate_limit"]) {
    assertEquals(getRpcFunctionName(path), "consume_rate_limit", `RPC function for ${path}`);
    assert(isAllowedRpcProxyPath(path), `allowlisted RPC rejected: ${path}`);
    assert(!isBlockedRpcProxyPath(path), `allowlisted RPC blocked: ${path}`);
  }

  for (const path of [
    "/rpc",
    "/rpc/consume_rate_limit/",
    "/rpc/%63onsume_rate_limit",
    "/rest/v1/rpc",
    "/rest/v1/rpc/consume_rate_limit/",
    "/rest/v1/rpc/%63onsume_rate_limit",
  ]) {
    assertEquals(getRpcFunctionName(path), "", `blocked RPC parser result for ${path}`);
    assert(!isAllowedRpcProxyPath(path), `blocked RPC was allowlisted: ${path}`);
    assert(isBlockedRpcProxyPath(path), `RPC path was not blocked: ${path}`);
  }

  for (const [path, functionName] of [
    ["/rpc/consume_rate_limit_prelogin", "consume_rate_limit_prelogin"],
    ["/rest/v1/rpc/run_data_retention", "run_data_retention"],
  ]) {
    assertEquals(getRpcFunctionName(path), functionName, `disallowed RPC parser result for ${path}`);
    assert(!isAllowedRpcProxyPath(path), `disallowed RPC was allowlisted: ${path}`);
    assert(isBlockedRpcProxyPath(path), `disallowed RPC path was not blocked: ${path}`);
  }
});

Deno.test("RPC auth requirement applies to direct and REST RPC path families", () => {
  for (const path of ["/rpc/consume_rate_limit", "/rest/v1/rpc/consume_rate_limit", "/rpc/run_data_retention"]) {
    assert(isUnauthorizedRpcProxyPath(path, false), `unauthenticated RPC accepted: ${path}`);
    assert(!isUnauthorizedRpcProxyPath(path, true), `authenticated RPC rejected: ${path}`);
  }
  assert(!isUnauthorizedRpcProxyPath("/rest/v1/profiles", false), "non-RPC path required RPC auth");
});
