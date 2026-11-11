import { authorizeAdminOpsAction } from "../../../supabase/functions/admin-ops/actions/index.ts";
import { dispatchAdminOpsAction } from "../../../supabase/functions/admin-ops/actions/index.ts";
import type { AdminOpsContext } from "../../../supabase/functions/admin-ops/context.ts";

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

Deno.test("Security: Role Escalation returns HTTP 403 for tenant accounts on admin-only actions", () => {
  const adminOnlyActions = [
    "get_notifications",
    "get_workspace_settings",
    "update_workspace_settings",
    "get_status_tracking",
    "get_workspace_dashboard",
    "bulk_import_items",
  ];

  for (const action of adminOnlyActions) {
    let observedStatus = 0;
    let observedPayload: Record<string, unknown> = {};
    const denied = authorizeAdminOpsAction({
      action,
      profileRole: "tenant_account",
      isWorkspaceSuspended: false,
      jsonResponse: (status, body) => {
        observedStatus = status;
        observedPayload = body;
        return Response.json(body, { status });
      },
    });

    assert(
      denied instanceof Response,
      `${action} must return a denial response`,
    );
    assert(denied.status === 403, `${action} must return HTTP 403`);
    assert(
      observedStatus === 403,
      `${action} response factory must receive 403`,
    );
    assert(
      JSON.stringify(observedPayload) ===
        JSON.stringify({ error: "Access denied" }),
      `${action} must use the stable access-denied error payload`,
    );
  }
});

Deno.test("Security: Privileged role changes are not exposed through the admin-ops action surface", async () => {
  const response = await dispatchAdminOpsAction({
    action: "set_workspace_account_role",
    jsonResponse: (status, body) => Response.json(body, { status }),
  } as AdminOpsContext);

  assert(
    response.status === 400,
    "role-management action must be rejected by admin-ops",
  );
  assert(
    JSON.stringify(await response.json()) ===
      JSON.stringify({ error: "Invalid action" }),
    "unsupported action must return the stable invalid-action payload",
  );
});

Deno.test("Security: Role Escalation authorization is wired to the service-role profile lookup, never token claims", async () => {
  // The handler registers Deno.serve at import, so it cannot be invoked here.
  // Instead pin the wiring the authorization guard depends on: the role fed to
  // authorizeAdminOpsAction must come from public.profiles looked up by the
  // verified subject. getExternalAuthUser returning only {id,email} is covered
  // by _shared/externalAuth_test.ts.
  const source = await Deno.readTextFile(
    new URL("../../../supabase/functions/admin-ops/index.ts", import.meta.url),
  );

  assert(
    /adminClient\s*\.from\("profiles"\)\s*\.select\("[^"]*\brole\b[^"]*"\)\s*\.eq\("id",\s*user\.id\)/
      .test(source),
    "admin-ops must resolve role from public.profiles by the verified user id via the service-role client",
  );
  const guardCalls = source.match(/authorizeAdminOpsAction\(\{[\s\S]*?\}\)/g) ?? [];
  assert(guardCalls.length > 0, "admin-ops must call authorizeAdminOpsAction");
  for (const call of guardCalls) {
    assert(
      /profileRole:\s*profile\.role\b/.test(call),
      "authorizeAdminOpsAction must receive the profile-resolved role",
    );
  }
  for (
    const [pattern, label] of [
      [/\bapp_metadata\b/, "app_metadata"],
      [/\buser_metadata\b/, "user_metadata"],
      [/\buser\.role\b/, "user.role"],
      [/\bclaims\??\.role\b/, "claims.role"],
    ] as const
  ) {
    assert(
      !pattern.test(source),
      `admin-ops must not read caller-controlled ${label} for authorization`,
    );
  }
});
