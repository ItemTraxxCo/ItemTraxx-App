import { rpcErrorToError, throwOnRpcError } from "./reportingRefresh.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("reporting RPC errors become actionable worker errors", () => {
  try {
    throwOnRpcError("refresh_super_reporting_views", {
      code: "42P01",
      message:
        'relation "public.super_reporting_tenant_metrics" does not exist',
    });
  } catch (error) {
    assert(error instanceof Error, "expected an Error instance");
    if (!(error instanceof Error)) return;
    assert(
      error.message ===
        'refresh_super_reporting_views failed (42P01): relation "public.super_reporting_tenant_metrics" does not exist',
      "expected the database code and message to be preserved",
    );
    return;
  }

  throw new Error("expected the reporting RPC error to throw");
});

Deno.test("successful reporting RPCs do not throw", () => {
  throwOnRpcError("refresh_super_reporting_views", null);
  assert(
    rpcErrorToError("refresh_super_reporting_views", null) === null,
    "successful RPCs should not create an error",
  );
});
