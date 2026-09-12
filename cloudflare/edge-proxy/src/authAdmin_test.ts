import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveInternalAuthAdminTarget } from "./authAdmin.ts";

type Row = Record<string, any>;

class Query {
  private readonly table: Row[];
  private operation: "select" | "update" | "insert" = "select";
  private updateValues: Row | null = null;
  private insertValue: Row | null = null;
  private filters: Array<(row: Row) => boolean> = [];

  constructor(table: Row[]) {
    this.table = table;
  }

  select(_fields?: string) {
    this.operation = "select";
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  ilike(field: string, value: string) {
    this.filters.push((row) =>
      String(row[field] ?? "").toLowerCase() === value.toLowerCase()
    );
    return this;
  }

  is(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  update(values: Row) {
    this.operation = "update";
    this.updateValues = values;
    return this;
  }

  insert(value: Row) {
    this.operation = "insert";
    this.insertValue = value;
    return this;
  }

  async maybeSingle() {
    const rows = await this.run();
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = { data: Row[] | null; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((
        value: { data: Row[] | null; error: null },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.run().then(
      (rows) => onfulfilled?.({ data: rows, error: null }) as TResult1,
      onrejected ?? undefined,
    );
  }

  private async run() {
    const matches = () =>
      this.table.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.operation === "update") {
      for (const row of matches()) Object.assign(row, this.updateValues);
      return [];
    }
    if (this.operation === "insert") {
      this.table.push({ ...(this.insertValue ?? {}) });
      return [];
    }
    return matches().map((row) => ({ ...row }));
  }
}

class FakeClient {
  readonly tables: Record<string, Row[]> = {
    profiles: [],
    workspaces: [],
    user: [],
    member: [],
  };
  readonly rpcCalls: Array<{ name: string; args: Row }> = [];

  schema(schema: string) {
    return {
      from: (table: string) =>
        new Query(this.tables[table] ?? (this.tables[table] = [])),
      rpc: async (name: string, args: Row) => {
        this.rpcCalls.push({ name, args });
        if (name === "better_auth_create_user") {
          this.tables.user.push({
            id: args.p_user_id,
            email: args.p_email,
            role: args.p_global_role,
          });
          const profile = this.tables.profiles.find((row) =>
            row.id === args.p_profile_id
          );
          if (profile) profile.better_auth_user_id = args.p_user_id;
          if (args.p_workspace_id) {
            this.tables.member.push({
              id: args.p_member_id,
              organizationId: args.p_workspace_id,
              userId: args.p_user_id,
              role: args.p_member_role,
            });
          }
        }
        return { data: args.p_user_id ?? null, error: null };
      },
    };
  }
}

const resolve = (
  client: FakeClient,
  profileId: string,
  action = "request_password_reset",
) =>
  resolveInternalAuthAdminTarget({
    dataClient: client,
    action,
    profileId,
  });

Deno.test("repairs a legacy profile mapping and preserves its workspace-admin boundary", async () => {
  const client = new FakeClient();
  client.tables.profiles.push({
    id: "profile-1",
    better_auth_user_id: null,
    auth_email: "Admin@Example.test",
    role: "workspace_admin",
    workspace_id: "workspace-1",
    is_active: true,
    deleted_at: null,
  });
  client.tables.workspaces.push({
    id: "workspace-1",
    better_auth_organization_id: "org-1",
  });
  client.tables.user.push({
    id: "user-1",
    email: "admin@example.test",
    role: "user",
  });

  assertEquals(await resolve(client, "profile-1"), {
    user_id: "user-1",
    email: "admin@example.test",
  });
  assertEquals(client.tables.profiles[0].better_auth_user_id, "user-1");
  assertEquals(client.tables.member.length, 1);
  assertEquals(
    {
      organizationId: client.tables.member[0].organizationId,
      userId: client.tables.member[0].userId,
      role: client.tables.member[0].role,
    },
    { organizationId: "org-1", userId: "user-1", role: "workspace_admin" },
  );
  assertEquals(client.rpcCalls, []);
});

Deno.test("provisions a missing legacy account with a random credential before sending reset", async () => {
  const client = new FakeClient();
  client.tables.profiles.push({
    id: "profile-2",
    better_auth_user_id: null,
    auth_email: "tenant@example.test",
    role: "tenant_account",
    workspace_id: "workspace-2",
    is_active: true,
    deleted_at: null,
  });
  client.tables.workspaces.push({
    id: "workspace-2",
    better_auth_organization_id: "org-2",
  });

  const target = await resolve(client, "profile-2");
  assertEquals(target?.email, "tenant@example.test");
  assertEquals(client.tables.profiles[0].better_auth_user_id, target?.user_id);
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(client.rpcCalls[0].name, "better_auth_create_user");
  assertEquals(client.rpcCalls[0].args.p_global_role, "user");
  assertEquals(client.rpcCalls[0].args.p_member_role, "tenant_account");
  assertEquals(client.rpcCalls[0].args.p_password_hash.length > 0, true);
});

Deno.test("does not repair a user already linked to another profile", async () => {
  const client = new FakeClient();
  client.tables.profiles.push(
    {
      id: "profile-3",
      better_auth_user_id: null,
      auth_email: "shared@example.test",
      role: "tenant_account",
      workspace_id: "workspace-3",
      deleted_at: null,
    },
    {
      id: "other-profile",
      better_auth_user_id: "user-3",
      auth_email: "shared@example.test",
      role: "tenant_account",
      workspace_id: "workspace-3",
      deleted_at: null,
    },
  );
  client.tables.user.push({
    id: "user-3",
    email: "shared@example.test",
    role: "user",
  });
  client.tables.workspaces.push({
    id: "workspace-3",
    better_auth_organization_id: "org-3",
  });

  await assertRejects(
    () => resolve(client, "profile-3"),
    Error,
    "already linked",
  );
  assertEquals(client.tables.profiles[0].better_auth_user_id, null);
});

Deno.test("does not move a Better Auth user across workspace memberships", async () => {
  const client = new FakeClient();
  client.tables.profiles.push({
    id: "profile-5",
    better_auth_user_id: null,
    auth_email: "admin5@example.test",
    role: "workspace_admin",
    workspace_id: "workspace-5",
    deleted_at: null,
  });
  client.tables.workspaces.push({
    id: "workspace-5",
    better_auth_organization_id: "org-5",
  });
  client.tables.user.push({
    id: "user-5",
    email: "admin5@example.test",
    role: "user",
  });
  client.tables.member.push({
    id: "member-5",
    organizationId: "org-other",
    userId: "user-5",
    role: "workspace_admin",
  });

  await assertRejects(
    () => resolve(client, "profile-5"),
    Error,
    "another ItemTraxx workspace",
  );
  assertEquals(client.tables.profiles[0].better_auth_user_id, null);
});

Deno.test("does not create or link accounts for unrelated internal actions", async () => {
  const client = new FakeClient();
  client.tables.profiles.push({
    id: "profile-4",
    better_auth_user_id: null,
    auth_email: "unmapped@example.test",
    role: "tenant_account",
    workspace_id: "workspace-4",
    deleted_at: null,
  });
  assertEquals(await resolve(client, "profile-4", "verify_password"), null);
  assertEquals(client.rpcCalls, []);
});
