import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleTenantAccountAction,
  type TenantAccountRepository,
} from "./tenantAccounts.ts";

const account = {
  id: "10000000-0000-4000-8000-000000000001",
  workspace_id: "20000000-0000-4000-8000-000000000001",
  workspace_name: "Demo Workspace",
  auth_email: "desk@example.test",
  role: "tenant_account" as const,
  is_active: true,
  deleted_at: null,
  created_at: "2026-07-25T00:00:00.000Z",
};

const makeRepository = () => {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const repository: TenantAccountRepository = {
    list: async () => [account],
    create: async (workspaceId, email) => ({ ...account, workspace_id: workspaceId, auth_email: email }),
    findActive: async () => account,
    setStatus: async (_id, isActive) => ({ ...account, is_active: isActive }),
    updateEmail: async (_id, email) => ({ ...account, auth_email: email }),
    sendReset: async (email) => { calls.push({ name: "sendReset", value: email }); },
    softDelete: async (id, at) => { calls.push({ name: "softDelete", value: { id, at } }); },
    revokeSessions: async (id, actorId, at) => { calls.push({ name: "revokeSessions", value: { id, actorId, at } }); },
    audit: async (action, id, metadata) => { calls.push({ name: "audit", value: { action, id, metadata } }); },
  };
  return { repository, calls };
};

Deno.test("Super Admin can list Tenant Accounts across workspaces", async () => {
  const { repository } = makeRepository();
  const result = await handleTenantAccountAction("list_tenant_accounts", { workspace_id: "all", search: "desk" }, {
    actorId: "30000000-0000-4000-8000-000000000001",
    now: () => "2026-07-25T01:00:00.000Z",
    repository,
  });
  assertEquals(result, { handled: true, status: 200, data: [account] });
});

Deno.test("Super Admin Tenant Account creation requires an explicit workspace", async () => {
  const { repository } = makeRepository();
  await assertRejects(
    () => handleTenantAccountAction("create_tenant_account", { auth_email: "desk@example.test" }, {
      actorId: "30000000-0000-4000-8000-000000000001",
      now: () => "2026-07-25T01:00:00.000Z",
      repository,
    }),
    Error,
    "Invalid request",
  );
});

Deno.test("Super Admin Tenant Account removal soft-deletes and revokes every active session", async () => {
  const { repository, calls } = makeRepository();
  const actorId = "30000000-0000-4000-8000-000000000001";
  const result = await handleTenantAccountAction("remove_tenant_account", { id: account.id }, {
    actorId,
    now: () => "2026-07-25T01:00:00.000Z",
    repository,
  });
  assertEquals(result, { handled: true, status: 200, data: { success: true } });
  assertEquals(calls.map((entry) => entry.name), ["softDelete", "revokeSessions", "audit"]);
  assertEquals(calls[1].value, {
    id: account.id,
    actorId,
    at: "2026-07-25T01:00:00.000Z",
  });
});

Deno.test("non-Tenant-Account actions remain available to the existing Super Admin dispatcher", async () => {
  const { repository } = makeRepository();
  const result = await handleTenantAccountAction("list_workspace_admins", {}, {
    actorId: "30000000-0000-4000-8000-000000000001",
    now: () => "2026-07-25T01:00:00.000Z",
    repository,
  });
  assertEquals(result, { handled: false });
});
