import { isBlockedRpcProxyPath } from "./index.ts";

Deno.test("blocks RPC proxy routes through direct and REST paths", () => {
  const blockedPaths = [
    "/rpc",
    "/rpc/run_data_retention",
    "/rpc/run_data_retention/",
    "/rpc/%72un_data_retention",
    "/rest/v1/rpc",
    "/rest/v1/rpc/run_data_retention",
    "/rest/v1/rpc/run_data_retention/",
    "/rest/v1/rpc/%72un_data_retention",
  ];

  for (const path of blockedPaths) {
    if (!isBlockedRpcProxyPath(path)) {
      throw new Error(`Expected RPC path to be blocked: ${path}`);
    }
  }
});

Deno.test("does not block non-RPC REST paths", () => {
  const allowedPaths = [
    "/rest/v1/profiles",
    "/rest/v1/tenants",
    "/functions/admin-ops",
  ];

  for (const path of allowedPaths) {
    if (isBlockedRpcProxyPath(path)) {
      throw new Error(`Expected non-RPC path to remain allowed: ${path}`);
    }
  }
});
