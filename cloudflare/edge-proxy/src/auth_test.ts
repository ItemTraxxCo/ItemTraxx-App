import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeBetterAuthCaptchaRequest } from "./authCaptcha.ts";
import {
  handleBetterAuthRequest,
  isActiveBetterAuthOrganizationMember,
  isActiveBetterAuthOrganizationActor,
  isActiveBetterAuthOrganizationMutation,
  isActiveBetterAuthOrganizationRead,
  filterActiveBetterAuthOrganizationRows,
  isBetterAuthOrganizationMutationPath,
  isActiveLinkedBetterAuthProfile,
  isBlockedBetterAuthOrganizationMemberManagement,
  hasRecentSuperAdminPasswordConfirmation,
  isBetterAuthPasskeyEnrollmentPath,
  isFreshActionConfirmationTimestamp,
  organizationLogoObjectPath,
  resolveSsoActor,
  sanitizeSsoProvider,
} from "./auth.ts";

Deno.test("Better Auth member-management routes are closed to workspace actors", () => {
  for (
    const path of [
      "/organization/update-member-role",
      "/organization/remove-member",
      "/organization/invite-member",
      "/organization/leave",
    ]
  ) {
    for (const role of ["workspace_admin", "tenant_account", "individual_account", undefined]) {
      assertEquals(
        isBlockedBetterAuthOrganizationMemberManagement(path, role),
        true,
        `${path} is blocked for ${role ?? "an unresolved role"}`,
      );
    }
    assertEquals(
      isBlockedBetterAuthOrganizationMemberManagement(path, "super_admin"),
      false,
      `${path} stays available to super admins`,
    );
  }
  for (
    const path of [
      "/organization/set-active",
      "/organization/update",
      "/organization/list-members",
      "/organization/get-full-organization",
    ]
  ) {
    assertEquals(
      isBlockedBetterAuthOrganizationMemberManagement(path, "workspace_admin"),
      false,
      `${path} is not a member-management route`,
    );
  }
});

Deno.test("organization logo replacements reuse one R2 object per organization", () => {
  const first = organizationLogoObjectPath("workspace-1");
  const replacement = organizationLogoObjectPath("workspace-1");
  assertEquals(first, replacement);
});

Deno.test(
  "Better Auth member and invitation mutations require an active target workspace",
  async () => {
    const activeWorkspace = { status: "active", archived_at: null };
    const archivedWorkspace = {
      status: "suspended",
      archived_at: "2026-10-08T00:00:00Z",
    };
    const createDataClient = (
      workspaces: Record<string, Record<string, unknown> | null>,
      invitationOrganizationId = "organization-1",
      organizationsBySlug: Record<string, string> = {
        "active-workspace": "organization-1",
        "archived-workspace": "organization-2",
      },
    ) => ({
      schema: (schema: string) => ({
        from: (table: string) => {
          const filters = new Map<string, unknown>();
          const query = {
            select: (_columns: string) => query,
            eq: (column: string, value: unknown) => {
              filters.set(column, value);
              return query;
            },
            is: (column: string, value: unknown) => {
              filters.set(column, value);
              return query;
            },
            in: (column: string, value: unknown[]) => {
              filters.set(column, value);
              return query;
            },
            maybeSingle: async () => {
              if (schema === "better_auth" && table === "invitation") {
                return {
                  data: filters.get("id") === "invitation-1"
                    ? { organizationId: invitationOrganizationId }
                    : null,
                  error: null,
                };
              }
              if (schema === "better_auth" && table === "organization") {
                const id = organizationsBySlug[String(filters.get("slug"))];
                return { data: id ? { id } : null, error: null };
              }
              if (schema === "public" && table === "workspaces") {
                return {
                  data: workspaces[String(filters.get("better_auth_organization_id"))] ?? null,
                  error: null,
                };
              }
              return { data: null, error: null };
            },
            then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
              const organizationIds = filters.get("better_auth_organization_id");
              const data = schema === "public" && table === "workspaces" && Array.isArray(organizationIds)
                ? organizationIds.flatMap((id) => {
                  const workspace = workspaces[String(id)];
                  return workspace?.status === "active" && workspace.archived_at === null
                    ? [{ better_auth_organization_id: id }]
                    : [];
                })
                : null;
              return Promise.resolve({ data, error: null }).then(resolve, reject);
            },
          };
          return query;
        },
      }),
    });
    const mutationCases = [
      { path: "/organization/delete", body: { organizationId: "organization-1" } },
      { path: "/organization/update", body: { organizationId: "organization-1" } },
      { path: "/organization/remove-member", body: { organizationId: "organization-1" } },
      { path: "/organization/update-member-role", body: { organizationId: "organization-1" } },
      { path: "/organization/leave", body: { organizationId: "organization-1" } },
      { path: "/organization/invite-member", body: { organizationId: "organization-1" } },
      { path: "/organization/set-active", body: { organizationId: "organization-1" } },
      { path: "/organization/cancel-invitation", body: { invitationId: "invitation-1" } },
      { path: "/organization/accept-invitation", body: { invitationId: "invitation-1" } },
      { path: "/organization/reject-invitation", body: { invitationId: "invitation-1" } },
    ] as const;

    for (const { path, body } of mutationCases) {
      assertEquals(isBetterAuthOrganizationMutationPath(path), true, `${path} is guarded`);
      assertEquals(
        await isActiveBetterAuthOrganizationMutation(
          createDataClient({ "organization-1": activeWorkspace }) as never,
          path,
          body,
          null,
          "organization-1",
          "tenant_admin",
        ),
        true,
        `${path} remains available for an active workspace`,
      );
      assertEquals(
        await isActiveBetterAuthOrganizationMutation(
          createDataClient({ "organization-1": archivedWorkspace }) as never,
          path,
          body,
          null,
          "organization-1",
          "tenant_admin",
        ),
        false,
        `${path} is denied for an archived workspace`,
      );
    }

    assertEquals(
      await isActiveBetterAuthOrganizationMutation(
        createDataClient({
          "organization-1": activeWorkspace,
          "organization-2": archivedWorkspace,
        }) as never,
        "/organization/update-member-role",
        { organizationId: "organization-2" },
        "organization-1",
        "organization-1",
        "tenant_admin",
      ),
      false,
      "an explicit target organization takes precedence over the active organization",
    );
    assertEquals(
      await isActiveBetterAuthOrganizationMutation(
        createDataClient({ "organization-1": activeWorkspace }) as never,
        "/organization/remove-member",
        {},
        "organization-1",
        "organization-1",
        "tenant_admin",
      ),
      true,
      "member routes preserve Better Auth's active-organization fallback",
    );
    assertEquals(
      await isActiveBetterAuthOrganizationMutation(
        createDataClient({ "organization-1": activeWorkspace }) as never,
        "/organization/leave",
        {},
        "organization-1",
        "organization-1",
        "tenant_admin",
      ),
      false,
      "leave requires the explicit organization ID used by Better Auth",
    );
    assertEquals(
      await isActiveBetterAuthOrganizationMutation(
        createDataClient({
          "organization-1": activeWorkspace,
          "organization-2": activeWorkspace,
        }, "organization-2") as never,
        "/organization/accept-invitation",
        { invitationId: "invitation-1" },
        null,
        "organization-1",
        "tenant_admin",
      ),
      false,
      "a workspace user cannot accept an invitation into a different workspace",
    );
    assertEquals(
      await isActiveBetterAuthOrganizationMutation(
        createDataClient({
          "organization-1": activeWorkspace,
          "organization-2": activeWorkspace,
        }) as never,
        "/organization/update-member-role",
        { organizationId: "organization-2" },
        "organization-1",
        "organization-1",
        "tenant_admin",
      ),
      false,
      "a workspace user cannot mutate members in a different active workspace",
    );
    assertEquals(isBetterAuthOrganizationMutationPath("/organization/list-members"), false);
    assertEquals(isBetterAuthOrganizationMutationPath("/organization/set-active"), true);
    assertEquals(
      await isActiveBetterAuthOrganizationMutation(
        createDataClient({ "organization-1": activeWorkspace }) as never,
        "/organization/set-active",
        { organizationSlug: "active-workspace" },
        null,
        "organization-1",
        "tenant_admin",
      ),
      true,
      "setting the active organization by slug remains available for the active workspace",
    );
    assertEquals(
      await isActiveBetterAuthOrganizationMutation(
        createDataClient({ "organization-1": archivedWorkspace }) as never,
        "/organization/set-active",
        { organizationId: null },
        "organization-1",
        "organization-1",
        "tenant_admin",
      ),
      true,
      "an archived workspace can clear its stale active organization",
    );
  },
);

Deno.test("Better Auth organization reads and active-organization targets require active workspaces", async () => {
  const activeWorkspace = { status: "active", archived_at: null };
  const archivedWorkspace = { status: "suspended", archived_at: "2026-10-08T00:00:00Z" };
  const createDataClient = (
    workspaces: Record<string, Record<string, unknown> | null>,
    invitationOrganizationId = "organization-1",
    organizationsBySlug: Record<string, string> = { "archived-workspace": "organization-2" },
  ) => ({
    schema: (schema: string) => ({
      from: (table: string) => {
        const filters = new Map<string, unknown>();
        const query = {
          select: (_columns: string) => query,
          eq: (column: string, value: unknown) => { filters.set(column, value); return query; },
          maybeSingle: async () => {
            if (schema === "better_auth" && table === "invitation") {
              return { data: filters.get("id") === "invitation-1" ? { organizationId: invitationOrganizationId } : null, error: null };
            }
            if (schema === "better_auth" && table === "organization") {
              const id = organizationsBySlug[String(filters.get("slug"))];
              return { data: id ? { id } : null, error: null };
            }
            if (schema === "public" && table === "workspaces") {
              return { data: workspaces[String(filters.get("better_auth_organization_id"))] ?? null, error: null };
            }
            return { data: null, error: null };
          },
        };
        return query;
      },
    }),
  });
  const client = createDataClient({
    "organization-1": activeWorkspace,
    "organization-2": archivedWorkspace,
  }) as never;

  for (const path of ["/organization/list-members", "/organization/list-invitations", "/organization/get-full-organization"]) {
    assertEquals(
      await isActiveBetterAuthOrganizationRead(
        client,
        path,
        { organizationId: "organization-2" },
        "organization-1",
        "organization-1",
        "tenant_account",
      ),
      false,
      `${path} denies reads from an archived target`,
    );
  }
  assertEquals(
    await isActiveBetterAuthOrganizationRead(
      client,
      "/organization/has-permission",
      {},
      "organization-1",
      "organization-1",
      "tenant_account",
      { organizationId: "organization-2", permissions: { member: ["read"] } },
    ),
    false,
    "permission checks cannot target an archived organization from the request body",
  );
  assertEquals(
    await isActiveBetterAuthOrganizationRead(
      client,
      "/organization/has-permission",
      {},
      "organization-1",
      "organization-1",
      "tenant_account",
      { permissions: { member: ["read"] } },
    ),
    true,
    "permission checks can use the active organization when the body omits its ID",
  );
  assertEquals(
    await isActiveBetterAuthOrganizationRead(
      client,
      "/organization/get-organization",
      { organizationSlug: "archived-workspace" },
      null,
      "organization-1",
      "tenant_account",
    ),
    false,
    "organization reads resolve and reject archived slug targets",
  );
  assertEquals(
    await isActiveBetterAuthOrganizationRead(
      createDataClient({ "organization-1": activeWorkspace }, "organization-2") as never,
      "/organization/get-invitation",
      { id: "invitation-1" },
      null,
      "organization-1",
      "tenant_account",
    ),
    false,
    "invitation details cannot reveal an archived organization",
  );
  assertEquals(
    await isActiveBetterAuthOrganizationRead(
      client,
      "/organization/get-organization",
      { organizationId: "organization-1" },
      null,
      "organization-1",
      "tenant_account",
    ),
    true,
    "active workspace organization reads remain available",
  );
  assertEquals(
    await isActiveBetterAuthOrganizationRead(
      client,
      "/organization/get-organization",
      { organizationId: "organization-1" },
      null,
      "organization-2",
      "tenant_account",
    ),
    false,
    "a stale membership cannot read a different workspace organization",
  );
  assertEquals(
    isActiveBetterAuthOrganizationActor({ role: "tenant_account", organizationId: null, workspaceStatus: "active", workspaceArchivedAt: null }),
    false,
    "tenant organization routes require a linked active workspace",
  );
  assertEquals(
    isActiveBetterAuthOrganizationActor({
      role: "tenant_account",
      organizationId: "organization-1",
      workspaceStatus: "active",
      workspaceArchivedAt: "2026-10-08T00:00:00Z",
    }),
    false,
    "a stale active status cannot override the workspace archive timestamp",
  );
  assertEquals(
    isActiveBetterAuthOrganizationActor({ role: "super_admin", organizationId: null, workspaceStatus: null, workspaceArchivedAt: null }),
    true,
    "super admins retain organization access without a tenant workspace",
  );
});

Deno.test("Better Auth organization lists omit archived organizations", async () => {
  const activeWorkspace = { status: "active", archived_at: null };
  const archivedWorkspace = { status: "suspended", archived_at: "2026-10-08T00:00:00Z" };
  const dataClient = {
    schema: (schema: string) => ({
      from: (table: string) => {
        const filters = new Map<string, unknown>();
        const query = {
          select: (_columns: string) => query,
          in: (column: string, values: unknown[]) => { filters.set(column, values); return query; },
          eq: (_column: string, _value: unknown) => query,
          is: (_column: string, _value: unknown) => query,
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
            const data = schema === "public" && table === "workspaces"
              ? (filters.get("better_auth_organization_id") as unknown[]).flatMap((id) => {
                const workspace = id === "organization-1" ? activeWorkspace : archivedWorkspace;
                return workspace.status === "active" && workspace.archived_at === null
                  ? [{ better_auth_organization_id: id }]
                  : [];
              })
              : null;
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    }),
  };
  const rows = [
    { id: "organization-1", name: "Active" },
    { id: "organization-2", name: "Archived" },
  ];
  assertEquals(
    await filterActiveBetterAuthOrganizationRows(
      dataClient as never,
      "/organization/list",
      rows,
      null,
      "super_admin",
    ),
    [{ id: "organization-1", name: "Active" }],
  );
  assertEquals(
    await filterActiveBetterAuthOrganizationRows(
      dataClient as never,
      "/organization/list",
      rows,
      "organization-1",
      "tenant_account",
    ),
    [{ id: "organization-1", name: "Active" }],
    "non-super-admin results are restricted to their actor organization",
  );
  assertEquals(
    await filterActiveBetterAuthOrganizationRows(
      dataClient as never,
      "/organization/list-user-invitations",
      [
        { id: "invite-1", organizationId: "organization-1" },
        { id: "invite-2", organizationId: "organization-2" },
      ],
      null,
      "super_admin",
    ),
    [{ id: "invite-1", organizationId: "organization-1" }],
    "user invitation lists omit invitations belonging to archived organizations",
  );
});

Deno.test(
  "organization logo reads require active profile, workspace, and membership",
  async () => {
    const authorize = async ({
      profile = {
        workspace_id: "workspace-1",
        is_active: true,
        deleted_at: null,
      },
      workspace,
      member,
    }: {
      profile?: Record<string, unknown>;
      workspace: Record<string, unknown>;
      member: Record<string, unknown> | null;
    }) => {
      let schemaName = "";
      const rows: Record<string, Record<string, unknown> | null> = {
        "public.profiles": profile,
        "public.workspaces": workspace,
        "better_auth.member": member,
      };
      const dataClient = {
        schema: (schema: string) => {
          schemaName = schema;
          return {
            from: (table: string) => {
              const filters = new Map<string, unknown>();
              const query = {
                select: (_columns: string) => query,
                eq: (column: string, value: unknown) => {
                  filters.set(column, value);
                  return query;
                },
                is: (column: string, value: unknown) => {
                  filters.set(column, value);
                  return query;
                },
                maybeSingle: () => {
                  let data = rows[`${schemaName}.${table}`] ?? null;
                  if (
                    table === "profiles" && (
                      filters.get("better_auth_user_id") !== "user-1" ||
                      filters.get("is_active") !== true ||
                      filters.get("deleted_at") !== null ||
                      data?.is_active !== true ||
                      data.deleted_at != null
                    )
                  ) data = null;
                  if (
                    table === "workspaces" &&
                    filters.get("id") !== "workspace-1"
                  ) {
                    data = null;
                  }
                  if (
                    table === "member" && (
                      filters.get("userId") !== "user-1" ||
                      filters.get("organizationId") !== "organization-1"
                    )
                  ) data = null;
                  return Promise.resolve({ data, error: null });
                },
              };
              return query;
            },
          };
        },
      };
      return await isActiveBetterAuthOrganizationMember(
        dataClient as never,
        "user-1",
        "organization-1",
      );
    };

    const activeWorkspace = {
      better_auth_organization_id: "organization-1",
      status: "active",
      archived_at: null,
    };
    assertEquals(
      await authorize({
        workspace: activeWorkspace,
        member: { id: "member-1" },
      }),
      true,
      "an active member of the profile's workspace should be allowed",
    );
    assertEquals(
      await authorize({
        profile: {
          workspace_id: "workspace-1",
          is_active: false,
          deleted_at: null,
        },
        workspace: activeWorkspace,
        member: { id: "member-1" },
      }),
      false,
      "inactive profiles should be denied",
    );
    assertEquals(
      await authorize({
        workspace: {
          ...activeWorkspace,
          better_auth_organization_id: "organization-2",
        },
        member: { id: "member-1" },
      }),
      false,
      "membership must not override the linked profile's different workspace",
    );
    assertEquals(
      await authorize({ workspace: activeWorkspace, member: null }),
      false,
      "users without organization membership should be denied",
    );
    assertEquals(
      await authorize({
        workspace: { ...activeWorkspace, archived_at: "2026-10-08T00:00:00Z" },
        member: { id: "member-1" },
      }),
      false,
      "archived workspaces should be denied",
    );
  },
);

Deno.test("only passkey enrollment endpoints use the fresh-confirmation guard", () => {
  assertEquals(isBetterAuthPasskeyEnrollmentPath("/passkey/generate-register-options"), true);
  assertEquals(isBetterAuthPasskeyEnrollmentPath("/passkey/verify-registration"), true);
  assertEquals(isBetterAuthPasskeyEnrollmentPath("/passkey/generate-authenticate-options"), false);
});

Deno.test("super-admin password confirmation must be fresh and bound to the existing session", async () => {
  const nowMs = Date.now();
  const filters: Array<[string, unknown]> = [];
  const query = {
    select: (_columns: string) => query,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    },
    maybeSingle: async () => ({
      data: {
        updated_at: new Date(nowMs).toISOString(),
        issued_by: "super_admin_settings_password",
      },
      error: null,
    }),
  };
  const dataClient = {
    schema: (schema: string) => {
      assertEquals(schema, "public");
      return dataClient;
    },
    from: (table: string) => {
      assertEquals(table, "privileged_session_stepups");
      return query;
    },
  };

  assertEquals(
    await hasRecentSuperAdminPasswordConfirmation(
      dataClient as never,
      "profile-1",
      "session-current",
      nowMs,
    ),
    true,
  );
  assertEquals(filters, [
    ["user_id", "profile-1"],
    ["role_scope", "super_admin"],
    ["binding_key", "session:session-current"],
    ["issued_by", "super_admin_settings_password"],
  ]);
});

Deno.test("super-admin password confirmation rejects stale timestamps", () => {
  const nowMs = Date.now();
  assertEquals(
    isFreshActionConfirmationTimestamp(
      new Date(nowMs - 5 * 60 * 1000).toISOString(),
      nowMs,
    ),
    true,
  );
  assertEquals(
    isFreshActionConfirmationTimestamp(
      new Date(nowMs - 5 * 60 * 1000 - 1).toISOString(),
      nowMs,
    ),
    false,
  );
  assertEquals(isFreshActionConfirmationTimestamp("invalid", nowMs), false);
});

Deno.test("promotes a form captcha field to Better Auth's header", async () => {
  const request = new Request("https://edge.itemtraxx.com/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=user%40example.com&password=correct-horse&captchaResponse=turnstile-token",
  });

  const normalized = await normalizeBetterAuthCaptchaRequest(request);

  assertNotEquals(normalized, request);
  assertEquals(normalized.headers.get("x-captcha-response"), "turnstile-token");
  assertEquals(
    normalized.headers.get("content-type"),
    "application/x-www-form-urlencoded;charset=UTF-8",
  );
  assertEquals(await normalized.text(), "email=user%40example.com&password=correct-horse");
});

Deno.test("leaves requests without a form captcha unchanged", async () => {
  const request = new Request("https://edge.itemtraxx.com/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=user%40example.com&password=correct-horse",
  });

  const normalized = await normalizeBetterAuthCaptchaRequest(request);

  assertEquals(normalized, request);
  assertEquals(await normalized.text(), "email=user%40example.com&password=correct-horse");
});

Deno.test("promotes a form captcha field on password reset requests", async () => {
  const request = new Request("https://edge.itemtraxx.com/api/auth//request-password-reset/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=user%40example.com&redirectTo=https%3A%2F%2Fitemtraxx.com%2Freset-password&captchaResponse=turnstile-token",
  });

  const normalized = await normalizeBetterAuthCaptchaRequest(request);

  assertNotEquals(normalized, request);
  assertEquals(normalized.headers.get("x-captcha-response"), "turnstile-token");
  assertEquals(
    await normalized.text(),
    "email=user%40example.com&redirectTo=https%3A%2F%2Fitemtraxx.com%2Freset-password",
  );
});

Deno.test("production password reset fails closed when Turnstile verification is unconfigured", async () => {
  const response = await handleBetterAuthRequest(
    new Request("https://edge.itemtraxx.com/api/auth/request-password-reset", {
      method: "POST",
    }),
    { ITX_ENVIRONMENT: "production" } as Env,
  );

  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    message: "Password reset verification is unavailable",
  });
});

Deno.test("sanitizes SSO provider configuration before returning it to the browser", () => {
  const sanitized = sanitizeSsoProvider({
    providerId: "acme",
    issuer: "https://idp.example.test",
    domain: "example.test",
    domainVerified: false,
    organizationId: "org-1",
    oidcConfig: JSON.stringify({ clientId: "public-id", clientSecret: "private-secret" }),
    samlConfig: JSON.stringify({ cert: "private-cert", privateKey: "private-key" }),
  });

  assertEquals(sanitized.oidcConfig, {});
  assertEquals(sanitized.samlConfig, {});
  assertEquals("private-secret" in sanitized, false);
  assertEquals("private-key" in sanitized, false);
});

Deno.test("linked Better Auth profile gate permits only active, undeleted profiles", async () => {
  for (const [profile, expected] of [
    [{ id: "profile-1", is_active: true, deleted_at: null }, true],
    [{ id: "profile-1", is_active: false, deleted_at: null }, false],
    [{ id: "profile-1", is_active: true, deleted_at: "2026-10-03T00:00:00Z" }, false],
    [null, false],
  ] as const) {
    const query = {
      select: (_columns: string) => query,
      eq: (_column: string, _value: string) => query,
      maybeSingle: async () => ({ data: profile, error: null }),
    };
    const client = {
      schema: (_schema: string) => client,
      from: (_table: string) => query,
    };
    assertEquals(
      await isActiveLinkedBetterAuthProfile(client as never, "better-auth-user-1"),
      expected,
    );
  }
});

Deno.test("resolves the SSO workspace without relying on a renamed foreign-key constraint", async () => {
  const queries: Array<{ table: string; selection: string; filters: Array<[string, unknown]> }> = [];
  const dataClient = {
    schema: (schema: string) => {
      assertEquals(schema, "public");
      return dataClient;
    },
    from: (table: string) => {
      const query = { table, selection: "", filters: [] as Array<[string, unknown]> };
      queries.push(query);
      const builder = {
        select: (selection: string) => { query.selection = selection; return builder; },
        eq: (column: string, value: unknown) => { query.filters.push([column, value]); return builder; },
        is: (_column: string, _value: unknown) => builder,
        maybeSingle: async () => ({
          data: table === "profiles"
            ? { id: "profile-1", role: "workspace_admin", workspace_id: "workspace-1" }
            : { better_auth_organization_id: "organization-1", status: "active", archived_at: null },
          error: null,
        }),
      };
      return builder;
    },
  };

  const actor = await resolveSsoActor(dataClient as never, "better-auth-user-1");

  assertEquals(actor, {
    profileId: "profile-1",
    role: "workspace_admin",
    workspaceId: "workspace-1",
    organizationId: "organization-1",
    workspaceStatus: "active",
    workspaceArchivedAt: null,
  });
  assertEquals(queries.map(({ table }) => table), ["profiles", "workspaces"]);
  assertEquals(queries[0].selection, "id,role,workspace_id");
  assertEquals(queries[1].selection, "better_auth_organization_id,status,archived_at");
  assertEquals(queries[1].filters, [["id", "workspace-1"]]);
});
