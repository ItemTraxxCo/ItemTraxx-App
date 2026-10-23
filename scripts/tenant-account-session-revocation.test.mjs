import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceAdminSource = await readFile(
  new URL("../supabase/functions/workspace-admin-mutate/index.ts", import.meta.url),
  "utf8",
);

test("workspace admin status changes and account removal revoke Better Auth sessions", () => {
  const actionsStart = workspaceAdminSource.indexOf(
    'if (["set_tenant_account_status","remove_tenant_account","send_tenant_account_reset"].includes(action))',
  );
  const actionsEnd = workspaceAdminSource.indexOf("if (!canManageAdmins)", actionsStart);

  assert.notEqual(actionsStart, -1, "tenant account action handler must exist");
  assert.notEqual(actionsEnd, -1, "tenant account action handler must have a boundary");

  const actionSource = workspaceAdminSource.slice(actionsStart, actionsEnd);
  assert.match(
    actionSource,
    /const revokeTenantAccountSessions = async \(\) => \{[\s\S]*?callBetterAuthAdmin\(\{ action: "revoke_sessions", profileId: id \}\)[\s\S]*?from\("account_sessions"\)[\s\S]*?if \(error\)/,
  );
  assert.equal(
    (actionSource.match(/revokeSessions: revokeTenantAccountSessions/g) ?? []).length,
    2,
    "status changes and removal must share the same revocation callback",
  );
  assert.match(
    actionSource,
    /isActive: false,[\s\S]*?update\(\{ is_active: isActive \}\)[\s\S]*?revokeSessions: revokeTenantAccountSessions[\s\S]*?update\(\{ deleted_at: revokedAt \}\)[\s\S]*?\.eq\("is_active", false\)/,
  );
  assert.match(actionSource, /\.eq\("workspace_id", requesterProfile\.workspace_id\)[\s\S]*?\.eq\("role", "tenant_account"\)/);
});
