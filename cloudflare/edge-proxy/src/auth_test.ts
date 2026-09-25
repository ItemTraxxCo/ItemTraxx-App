import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeBetterAuthCaptchaRequest } from "./authCaptcha.ts";
import { resolveSsoActor, sanitizeSsoProvider } from "./auth.ts";

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
            : { better_auth_organization_id: "organization-1", status: "active" },
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
  });
  assertEquals(queries.map(({ table }) => table), ["profiles", "workspaces"]);
  assertEquals(queries[0].selection, "id,role,workspace_id");
  assertEquals(queries[1].filters, [["id", "workspace-1"]]);
});
