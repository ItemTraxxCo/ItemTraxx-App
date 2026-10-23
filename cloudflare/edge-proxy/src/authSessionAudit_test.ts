import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAdminLoginAuditRecord } from "./authSessionAudit.ts";

const profile = {
  id: "00000000-0000-4000-8000-000000000001",
  better_auth_user_id: "00000000-0000-4000-8000-000000000004",
  workspace_id: "00000000-0000-4000-8000-000000000002",
  role: "workspace_admin",
  is_active: true,
  deleted_at: null,
};
const session = {
  id: "00000000-0000-4000-8000-000000000003",
  userId: profile.better_auth_user_id,
};

Deno.test("admin login audit rows use the active profile and Better Auth session", () => {
  assertEquals(buildAdminLoginAuditRecord(profile, session), {
    workspace_id: profile.workspace_id,
    actor_id: profile.id,
    action_type: "admin_login",
    entity_type: "auth_session",
    entity_id: session.id,
    metadata: {
      source: "better_auth_session_create",
      role: "workspace_admin",
    },
  });
});

Deno.test("admin login audit rows reject unrelated, inactive, and mismatched profiles", () => {
  assertEquals(
    buildAdminLoginAuditRecord({ ...profile, role: "tenant_account" }, session),
    null,
  );
  assertEquals(
    buildAdminLoginAuditRecord({ ...profile, is_active: false }, session),
    null,
  );
  assertEquals(
    buildAdminLoginAuditRecord({ ...profile, better_auth_user_id: null }, session),
    null,
  );
  assertEquals(
    buildAdminLoginAuditRecord(
      { ...profile, better_auth_user_id: "00000000-0000-4000-8000-000000000005" },
      session,
    ),
    null,
  );
});
