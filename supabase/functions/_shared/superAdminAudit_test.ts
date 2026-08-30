import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { writeSuperAdminAudit } from "./superAdminAudit.ts";

Deno.test("super admin audit writes to the dedicated feed with a complete actor/target envelope", async () => {
  let table = "";
  let row: Record<string, unknown> | null = null;
  const client = {
    from: (name: string) => ({
      insert: async (value: Record<string, unknown>) => {
        table = name;
        row = value;
        return { error: null };
      },
    }),
  };

  await writeSuperAdminAudit(client, {
    actorId: "10000000-0000-4000-8000-000000000001",
    actorEmail: "admin@example.test",
    actionType: "create_item",
    targetType: "item",
    targetId: "20000000-0000-4000-8000-000000000001",
    metadata: { workspace_id: "30000000-0000-4000-8000-000000000001" },
  });

  assertEquals(table, "super_admin_audit_logs");
  assertEquals(row, {
    actor_id: "10000000-0000-4000-8000-000000000001",
    actor_email: "admin@example.test",
    action_type: "create_item",
    target_type: "item",
    target_id: "20000000-0000-4000-8000-000000000001",
    metadata: { workspace_id: "30000000-0000-4000-8000-000000000001" },
  });
});

Deno.test("super admin audit fails closed when persistence fails", async () => {
  let called = false;
  const client = {
    from: (name: string) => ({
      insert: async (_value: Record<string, unknown>) => {
        called = name === "super_admin_audit_logs";
        return { error: { message: "database unavailable" } };
      },
    }),
  };

  await assertRejects(
    () => writeSuperAdminAudit(client, {
      actorId: "10000000-0000-4000-8000-000000000001",
      actionType: "delete_item",
      targetType: "item",
    }),
    Error,
    "Unable to write Super Admin audit log.",
  );
  assert(called, "expected the dedicated audit table to be used");
});
