import {
  purgeExpiredWorkspaces,
  type WorkspacePurgeClaim,
  type WorkspacePurgeDeps,
} from "./workspacePurge.ts";

const assertEquals = (actual: unknown, expected: unknown) => {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right} but received ${left}`);
};

const workspace = (id: string, org: string | null = "org-1"): WorkspacePurgeClaim => ({
  id,
  name: `Workspace ${id}`,
  slug: id,
  better_auth_organization_id: org,
});

const makeDeps = (overrides: Partial<WorkspacePurgeDeps> = {}) => {
  const calls: string[] = [];
  const deps: WorkspacePurgeDeps = {
    claim: (limit) => {
      calls.push(`claim:${limit}`);
      return Promise.resolve([workspace("w1")]);
    },
    listProfiles: () => Promise.resolve([{ id: "p1", better_auth_user_id: "u1" }]),
    deleteBetterAuthUser: (profileId) => {
      calls.push(`user:${profileId}`);
      return Promise.resolve();
    },
    deleteBetterAuthOrganization: (orgId) => {
      calls.push(`org:${orgId}`);
      return Promise.resolve();
    },
    listSupportAttachmentPaths: () => Promise.resolve(["a/b.png"]),
    removeSupportAttachments: (paths) => {
      calls.push(`files:${paths.length}`);
      return Promise.resolve();
    },
    purgeData: (workspaceId, external) => {
      calls.push(`purge:${workspaceId}:${JSON.stringify(external)}`);
      return Promise.resolve({});
    },
    release: (workspaceId) => {
      calls.push(`release:${workspaceId}`);
      return Promise.resolve();
    },
    log: () => undefined,
    ...overrides,
  };
  return { deps, calls };
};

Deno.test("purges external systems before the database transaction", async () => {
  const { deps, calls } = makeDeps();
  const result = await purgeExpiredWorkspaces(deps, 2);

  assertEquals(result, { claimed: 1, purged: 1, failed: 0 });
  assertEquals(calls, [
    "claim:2",
    "user:p1",
    "org:org-1",
    "files:1",
    'purge:w1:{"better_auth_users":1,"support_attachment_files":1,"organization_logo":1}',
  ]);
});

Deno.test("does nothing when no workspace is due", async () => {
  const { deps, calls } = makeDeps({ claim: () => Promise.resolve([]) });
  assertEquals(await purgeExpiredWorkspaces(deps), { claimed: 0, purged: 0, failed: 0 });
  assertEquals(calls, []);
});

Deno.test("treats an already-removed Better Auth user as success", async () => {
  const { deps, calls } = makeDeps({
    deleteBetterAuthUser: () => Promise.reject(new Error("User not found")),
  });
  const result = await purgeExpiredWorkspaces(deps);

  assertEquals(result.purged, 1);
  assertEquals(calls.some((call) => call.startsWith("purge:")), true);
});

Deno.test("releases the claim and never touches the database when an external step fails", async () => {
  const { deps, calls } = makeDeps({
    deleteBetterAuthOrganization: () => Promise.reject(new Error("Better Auth administration failed")),
  });
  const result = await purgeExpiredWorkspaces(deps);

  assertEquals(result, { claimed: 1, purged: 0, failed: 1 });
  assertEquals(calls.includes("release:w1"), true);
  assertEquals(calls.some((call) => call.startsWith("purge:")), false);
});

Deno.test("one failing workspace does not block the next", async () => {
  let attempt = 0;
  const { deps, calls } = makeDeps({
    claim: () => Promise.resolve([workspace("w1"), workspace("w2", null)]),
    listProfiles: (workspaceId) => {
      attempt += 1;
      return workspaceId === "w1"
        ? Promise.reject(new Error("db down"))
        : Promise.resolve([]);
    },
  });
  const result = await purgeExpiredWorkspaces(deps);

  assertEquals(attempt, 2);
  assertEquals(result, { claimed: 2, purged: 1, failed: 1 });
  assertEquals(calls.includes("release:w1"), true);
  assertEquals(calls.some((call) => call.startsWith("purge:w2")), true);
});
