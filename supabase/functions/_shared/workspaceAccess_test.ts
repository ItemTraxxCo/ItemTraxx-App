import { resolveWorkspaceAccess } from "./workspaceAccess.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("workspace access allows an explicitly active workspace", () => {
  const result = resolveWorkspaceAccess({ status: "active" }, null);
  assert(result.allowed && result.reason === "active", "expected active access");
});

Deno.test("workspace access denies suspended and unknown statuses", () => {
  const suspended = resolveWorkspaceAccess({ status: "suspended" }, null);
  assert(
    !suspended.allowed && suspended.reason === "disabled",
    "expected suspended workspace denial",
  );

  const unknown = resolveWorkspaceAccess({ status: "archived" }, null);
  assert(
    !unknown.allowed && unknown.reason === "disabled",
    "expected non-active workspace denial",
  );
});

Deno.test("workspace access fails closed when status cannot be trusted", () => {
  const missing = resolveWorkspaceAccess(null, null);
  assert(
    !missing.allowed && missing.reason === "unavailable",
    "expected missing status to fail closed",
  );

  const queryError = resolveWorkspaceAccess(
    { status: "active" },
    new Error("workspace query failed"),
  );
  assert(
    !queryError.allowed && queryError.reason === "unavailable",
    "expected query errors to fail closed",
  );
});
