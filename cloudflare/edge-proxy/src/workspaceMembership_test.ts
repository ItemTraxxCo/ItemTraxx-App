import { ensureWorkspaceAdminMembership } from "./workspaceMembership.ts";

Deno.test("workspace admin accepts an already synchronized membership", async () => {
  let updates = 0;
  await ensureWorkspaceAdminMembership(async () => ({ id: "m1", role: "admin" }), async () => { updates++; return true; });
  if (updates !== 0) throw new Error("already synchronized membership was updated");
});

Deno.test("workspace admin synchronizes a legacy role and rejects missing or unexpected roles", async () => {
  let updates = 0;
  await ensureWorkspaceAdminMembership(async () => ({ id: "m1", role: "workspace_admin" }), async (id) => { if (id !== "m1") throw new Error("wrong member"); updates++; return true; });
  if (updates !== 1) throw new Error("legacy role not synchronized");
  for (const value of [null, { id: "m1", role: "tenant_account" }]) {
    let failed = false;
    try { await ensureWorkspaceAdminMembership(async () => value, async () => true); } catch { failed = true; }
    if (!failed) throw new Error("invalid role accepted");
  }
  let failed = false;
  try { await ensureWorkspaceAdminMembership(async () => ({ id: "m1", role: "workspace_admin" }), async () => false); } catch { failed = true; }
  if (!failed) throw new Error("failed role update accepted");
});
