import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { setTenantAccountStatusSafely } from "./tenantAccountStatus.ts";

Deno.test("suspension disables the profile before revoking sessions", async () => {
  const events: string[] = [];
  const result = await setTenantAccountStatusSafely({
    isActive: false,
    updateStatus: async (isActive) => {
      events.push(`status:${isActive}`);
      return { isActive };
    },
    revokeSessions: async () => {
      events.push("revoke");
    },
  });

  assertEquals(result, { isActive: false });
  assertEquals(events, ["status:false", "revoke"]);
});

Deno.test("restore revokes sessions before making the profile active", async () => {
  const events: string[] = [];
  const result = await setTenantAccountStatusSafely({
    isActive: true,
    updateStatus: async (isActive) => {
      events.push(`status:${isActive}`);
      return { isActive };
    },
    revokeSessions: async () => {
      events.push("revoke");
    },
  });

  assertEquals(result, { isActive: true });
  assertEquals(events, ["revoke", "status:true"]);
});

Deno.test("failed session revocation blocks restore and preserves suspension", async () => {
  let isActive = false;
  let statusUpdates = 0;

  await assertRejects(
    () =>
      setTenantAccountStatusSafely({
        isActive: true,
        updateStatus: async (next) => {
          statusUpdates += 1;
          isActive = next;
          return next;
        },
        revokeSessions: async () => {
          throw new Error("revocation unavailable");
        },
      }),
    Error,
    "revocation unavailable",
  );

  assertEquals(isActive, false);
  assertEquals(statusUpdates, 0);
});

Deno.test("after failed suspension, restore must revoke again before reactivation", async () => {
  let isActive = true;
  let sessionsRevoked = false;
  let revokeAttempts = 0;
  const events: string[] = [];
  const updateStatus = async (next: boolean) => {
    events.push(`status:${next}`);
    isActive = next;
    return next;
  };
  const revokeSessions = async () => {
    revokeAttempts += 1;
    events.push(`revoke:${revokeAttempts}`);
    if (revokeAttempts === 1) throw new Error("temporary revocation failure");
    sessionsRevoked = true;
  };

  await assertRejects(
    () =>
      setTenantAccountStatusSafely({
        isActive: false,
        updateStatus,
        revokeSessions,
      }),
    Error,
    "temporary revocation failure",
  );
  assertEquals(isActive, false);
  assertEquals(sessionsRevoked, false);

  await setTenantAccountStatusSafely({
    isActive: true,
    updateStatus,
    revokeSessions,
  });

  assertEquals(events, ["status:false", "revoke:1", "revoke:2", "status:true"]);
  assertEquals(isActive, true);
  assertEquals(sessionsRevoked, true);
});

Deno.test("restore racing with in-flight suspension revokes before activating", async () => {
  let isActive = true;
  let sessionsRevoked = false;
  let revokeCalls = 0;
  let signalFirstRevokeStarted: () => void = () => {};
  let releaseFirstRevoke: () => void = () => {};
  const firstRevokeStarted = new Promise<void>((resolve) => {
    signalFirstRevokeStarted = resolve;
  });
  const firstRevokeBarrier = new Promise<void>((resolve) => {
    releaseFirstRevoke = resolve;
  });
  const events: string[] = [];
  const updateStatus = async (next: boolean) => {
    events.push(`status:${next}`);
    isActive = next;
    return next;
  };
  const revokeSessions = async () => {
    const callNumber = ++revokeCalls;
    events.push(`revoke:start:${callNumber}`);
    if (callNumber === 1) {
      signalFirstRevokeStarted();
      await firstRevokeBarrier;
    } else {
      sessionsRevoked = true;
    }
    events.push(`revoke:done:${callNumber}`);
  };

  const suspension = setTenantAccountStatusSafely({
    isActive: false,
    updateStatus,
    revokeSessions,
  });
  await firstRevokeStarted;

  await setTenantAccountStatusSafely({
    isActive: true,
    updateStatus,
    revokeSessions,
  });

  assertEquals(isActive, true);
  assertEquals(sessionsRevoked, true);
  assertEquals(events.slice(0, 5), [
    "status:false",
    "revoke:start:1",
    "revoke:start:2",
    "revoke:done:2",
    "status:true",
  ]);

  releaseFirstRevoke();
  await suspension;
  assertEquals(isActive, true);
  assertEquals(sessionsRevoked, true);
});
