import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { setWorkspaceAdminStatusSafely } from "./workspaceAdminStatus.ts";

Deno.test("workspace-admin suspension updates the scoped profile before revoking sessions", async () => {
  const events: string[] = [];
  const result = await setWorkspaceAdminStatusSafely({
    isActive: false,
    validateTarget: async () => true,
    updateStatus: async (isActive) => {
      events.push(`scoped-update:${isActive}`);
      return { isActive };
    },
    revokeSessions: async () => {
      events.push("revoke");
    },
  });

  assertEquals(result, { isActive: false });
  assertEquals(events, ["scoped-update:false", "revoke"]);
});

Deno.test("workspace-admin suspension does not revoke sessions when the scoped update fails", async () => {
  const events: string[] = [];

  await assertRejects(
    () =>
      setWorkspaceAdminStatusSafely({
        isActive: false,
        validateTarget: async () => true,
        updateStatus: async () => {
          events.push("scoped-update");
          throw new Error("profile is not in the caller workspace");
        },
        revokeSessions: async () => {
          events.push("revoke");
        },
      }),
    Error,
    "profile is not in the caller workspace",
  );

  assertEquals(events, ["scoped-update"]);
});

Deno.test("workspace-admin activation revokes existing sessions before restoring access", async () => {
  const events: string[] = [];

  await setWorkspaceAdminStatusSafely({
    isActive: true,
    validateTarget: async () => {
      events.push("validate-target");
      return false;
    },
    updateStatus: async (isActive) => {
      events.push(`scoped-update:${isActive}`);
      return isActive;
    },
    revokeSessions: async () => {
      events.push("revoke");
    },
  });

  assertEquals(events, ["validate-target", "revoke", "scoped-update:true"]);
});

Deno.test("workspace-admin activation does not revoke a target outside the workspace", async () => {
  const events: string[] = [];

  await assertRejects(
    () =>
      setWorkspaceAdminStatusSafely({
        isActive: true,
        validateTarget: async () => {
          events.push("validate-target");
          throw new Error("profile is not in the caller workspace");
        },
        updateStatus: async () => {
          events.push("scoped-update:true");
          return true;
        },
        revokeSessions: async () => {
          events.push("revoke");
        },
      }),
    Error,
    "profile is not in the caller workspace",
  );

  assertEquals(events, ["validate-target"]);
});

Deno.test("workspace-admin activation does not restore access if session revocation fails", async () => {
  const events: string[] = [];

  await assertRejects(
    () =>
      setWorkspaceAdminStatusSafely({
        isActive: true,
        validateTarget: async () => {
          events.push("validate-target");
          return false;
        },
        updateStatus: async () => {
          events.push("scoped-update:true");
          return true;
        },
        revokeSessions: async () => {
          events.push("revoke");
          throw new Error("revoke failed");
        },
      }),
    Error,
    "revoke failed",
  );

  assertEquals(events, ["validate-target", "revoke"]);
});

Deno.test("workspace-admin activation preserves sessions for an already-active target", async () => {
  const events: string[] = [];

  await setWorkspaceAdminStatusSafely({
    isActive: true,
    validateTarget: async () => {
      events.push("validate-target");
      return true;
    },
    updateStatus: async () => {
      events.push("scoped-update:true");
      return true;
    },
    revokeSessions: async () => {
      events.push("revoke");
    },
  });

  assertEquals(events, ["validate-target", "scoped-update:true"]);
});
