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
    create: async (workspaceId, email, id) => {
      calls.push({ name: "create", value: { workspaceId, email, id } });
      return { ...account, id, workspace_id: workspaceId, auth_email: email };
    },
    findActive: async () => account,
    setStatus: async (id, isActive) => {
      calls.push({ name: "setStatus", value: { id, isActive } });
      return { ...account, is_active: isActive };
    },
    updateEmail: async (id, email) => {
      calls.push({ name: "updateEmail", value: { id, email } });
      return { ...account, auth_email: email };
    },
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

Deno.test("saving an unchanged Tenant Account email preserves the active setup link", async () => {
  const { repository, calls } = makeRepository();
  const result = await handleTenantAccountAction("update_tenant_account_email", {
    id: account.id,
    auth_email: "  DESK@example.test ",
  }, {
    actorId: "30000000-0000-4000-8000-000000000001",
    now: () => "2026-07-25T01:00:00.000Z",
    repository,
  });

  assertEquals(result, { handled: true, status: 200, data: account });
  assertEquals(calls, []);
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
  assertEquals(calls.map((entry) => entry.name), ["audit", "softDelete", "revokeSessions"]);
  assertEquals(calls[2].value, {
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

Deno.test("Super Admin can create a Tenant Account and records an audit entry", async () => {
  const { repository, calls } = makeRepository();
  const result = await handleTenantAccountAction("create_tenant_account", {
    workspace_id: account.workspace_id,
    auth_email: account.auth_email,
  }, {
    actorId: "30000000-0000-4000-8000-000000000001",
    now: () => "2026-07-25T01:00:00.000Z",
    repository,
  });

  assertEquals(result.handled, true);
  if (!result.handled) throw new Error("Tenant Account creation was not handled.");
  assertEquals(result.status, 200);
  const created = result.data as typeof account;
  assertEquals(created.workspace_id, account.workspace_id);
  assertEquals(created.auth_email, account.auth_email);
  assertEquals(calls, [{
    name: "audit",
    value: {
      action: "create_tenant_account",
      id: created.id,
      metadata: {
        workspace_id: account.workspace_id,
        auth_email: account.auth_email,
        event_phase: "requested",
      },
    },
  }, {
    name: "create",
    value: {
      workspaceId: account.workspace_id,
      email: account.auth_email,
      id: created.id,
    },
  }]);
});

Deno.test("Tenant Account mutations report not-found for a deleted or missing account", async () => {
  const { repository } = makeRepository();
  repository.findActive = async () => null;
  const result = await handleTenantAccountAction("send_tenant_account_reset", {
    id: account.id,
  }, {
    actorId: "30000000-0000-4000-8000-000000000001",
    now: () => "2026-07-25T01:00:00.000Z",
    repository,
  });

  assertEquals(result, { handled: true, status: 404, error: "Tenant Account not found." });
});

Deno.test("Super Admin can toggle a Tenant Account's active status", async () => {
  const { repository, calls } = makeRepository();
  const result = await handleTenantAccountAction("set_tenant_account_status", {
    id: account.id,
    is_active: false,
  }, {
    actorId: "30000000-0000-4000-8000-000000000001",
    now: () => "2026-07-25T01:00:00.000Z",
    repository,
  });

  assertEquals(result, { handled: true, status: 200, data: { ...account, is_active: false } });
  assertEquals(calls, [{
    name: "audit",
    value: {
      action: "set_tenant_account_status",
      id: account.id,
      metadata: { is_active: false, event_phase: "requested" },
    },
  }, {
    name: "setStatus",
    value: { id: account.id, isActive: false },
  }]);
});

Deno.test("Setting a Tenant Account's status requires an explicit boolean", async () => {
  const { repository } = makeRepository();
  await assertRejects(
    () =>
      handleTenantAccountAction("set_tenant_account_status", { id: account.id, is_active: "yes" }, {
        actorId: "30000000-0000-4000-8000-000000000001",
        now: () => "2026-07-25T01:00:00.000Z",
        repository,
      }),
    Error,
    "Invalid request",
  );
});

Deno.test("Super Admin can change a Tenant Account's email", async () => {
  const { repository, calls } = makeRepository();
  const result = await handleTenantAccountAction("update_tenant_account_email", {
    id: account.id,
    auth_email: "new-desk@example.test",
  }, {
    actorId: "30000000-0000-4000-8000-000000000001",
    now: () => "2026-07-25T01:00:00.000Z",
    repository,
  });

  assertEquals(result, { handled: true, status: 200, data: { ...account, auth_email: "new-desk@example.test" } });
  assertEquals(calls, [
    {
      name: "audit",
      value: {
        action: "update_tenant_account_email",
        id: account.id,
        metadata: { auth_email: "new-desk@example.test", event_phase: "requested" },
      },
    },
    { name: "updateEmail", value: { id: account.id, email: "new-desk@example.test" } },
  ]);
});

Deno.test("Super Admin can trigger a Tenant Account password reset email", async () => {
  const { repository, calls } = makeRepository();
  const result = await handleTenantAccountAction("send_tenant_account_reset", {
    id: account.id,
  }, {
    actorId: "30000000-0000-4000-8000-000000000001",
    now: () => "2026-07-25T01:00:00.000Z",
    repository,
  });

  assertEquals(result, { handled: true, status: 200, data: { success: true } });
  assertEquals(calls, [
    {
      name: "audit",
      value: {
        action: "send_tenant_account_reset",
        id: account.id,
        metadata: { event_phase: "requested" },
      },
    },
    { name: "sendReset", value: account.auth_email },
  ]);
});

Deno.test("Tenant Account mutations do not proceed when audit logging fails", async () => {
  const cases = [
    {
      action: "create_tenant_account",
      payload: {
        workspace_id: account.workspace_id,
        auth_email: account.auth_email,
      },
    },
    {
      action: "set_tenant_account_status",
      payload: { id: account.id, is_active: false },
    },
    {
      action: "update_tenant_account_email",
      payload: { id: account.id, auth_email: "new-desk@example.test" },
    },
    { action: "send_tenant_account_reset", payload: { id: account.id } },
    { action: "remove_tenant_account", payload: { id: account.id } },
  ];

  for (const { action, payload } of cases) {
    const { repository, calls } = makeRepository();
    repository.audit = async () => {
      throw new Error("audit unavailable");
    };

    await assertRejects(
      () => handleTenantAccountAction(action, payload, {
        actorId: "30000000-0000-4000-8000-000000000001",
        now: () => "2026-07-25T01:00:00.000Z",
        repository,
      }),
      Error,
      "audit unavailable",
    );
    assertEquals(calls, [], `${action} must not mutate before audit succeeds`);
  }
});
