import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { admin, captcha, jwt, organization, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { dash } from "@better-auth/infra";
import { importJWK, SignJWT, type JWK, type JWTPayload } from "jose";
import {
  globalAccess,
  globalRoles,
  organizationAccess,
  organizationRoles,
} from "./auth/permissions.ts";
import { parseCsv } from "./cors.ts";
import {
  createBetterAuthDataClient,
  supabaseBetterAuthAdapter,
} from "./supabaseBetterAuthAdapter.ts";

type BetterAuthEnv = Env & {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_API_KEY?: string;
  BETTER_AUTH_TRUSTED_ORIGINS: string;
  BETTER_AUTH_JWT_ISSUER: string;
  BETTER_AUTH_JWT_AUDIENCE: string;
  BETTER_AUTH_JWT_PRIVATE_JWK: string;
  BETTER_AUTH_JWT_PUBLIC_JWK: string;
  BETTER_AUTH_PASSKEY_RP_ID: string;
  BETTER_AUTH_PASSKEY_ORIGIN: string;
  BETTER_AUTH_TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  ITX_RESEND_FROM?: string;
  ITX_INTERNAL_AUTH_SECRET?: string;
};

const parseJwk = (value: string, label: string): JWK => {
  try {
    return JSON.parse(value) as JWK;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
};

const signSupabaseJwt = async (
  env: BetterAuthEnv,
  payload: JWTPayload,
  header: { typ?: string; cty?: string } = {},
) => {
  const jwk = parseJwk(env.BETTER_AUTH_JWT_PRIVATE_JWK, "BETTER_AUTH_JWT_PRIVATE_JWK");
  if (!jwk.kid) throw new Error("BETTER_AUTH_JWT_PRIVATE_JWK must include kid");
  const key = await importJWK(jwk, "ES256");
  return new SignJWT(payload)
    .setProtectedHeader({ ...header, alg: "ES256", kid: jwk.kid, typ: header.typ ?? "JWT" })
    .sign(key);
};

let cachedKey = "";
let cachedAuth: any = null;
let cachedDataClient: ReturnType<typeof createBetterAuthDataClient> | null = null;

export const getBetterAuth = (rawEnv: Env) => {
  const env = rawEnv as BetterAuthEnv;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const supabaseUrl = env.SUPABASE_URL?.trim();
  if (!serviceRoleKey || !supabaseUrl) throw new Error("Better Auth Data API configuration is missing");
  const signingKeyId = parseJwk(
    env.BETTER_AUTH_JWT_PRIVATE_JWK,
    "BETTER_AUTH_JWT_PRIVATE_JWK",
  ).kid;
  if (!signingKeyId) throw new Error("BETTER_AUTH_JWT_PRIVATE_JWK must include kid");
  const cacheKey = `${supabaseUrl}|${serviceRoleKey.slice(-8)}|${env.BETTER_AUTH_URL}|${env.BETTER_AUTH_JWT_ISSUER}|${env.BETTER_AUTH_JWT_PRIVATE_JWK}`;
  if (cachedAuth && cachedKey === cacheKey) return cachedAuth;

  const dataClient = createBetterAuthDataClient(supabaseUrl, serviceRoleKey);
  cachedDataClient = dataClient;
  const configuredUrl = new URL(env.BETTER_AUTH_URL);
  const isProductionOrigin = configuredUrl.protocol === "https:" && configuredUrl.hostname.endsWith("itemtraxx.com");
  const passkeyOrigins = parseCsv(env.BETTER_AUTH_PASSKEY_ORIGIN);
  cachedAuth = betterAuth({
    appName: "ItemTraxx",
    database: supabaseBetterAuthAdapter(dataClient),
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: parseCsv(env.BETTER_AUTH_TRUSTED_ORIGINS),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (!env.RESEND_API_KEY || !env.ITX_RESEND_FROM) {
          throw new Error("Password reset email delivery is not configured");
        }
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.ITX_RESEND_FROM,
            to: [user.email],
            subject: "Reset your ItemTraxx password",
            text: `Use this single-use link to reset your ItemTraxx password. It expires in 60 minutes: ${url}`,
          }),
        });
        if (!response.ok) throw new Error(`Password reset email delivery failed (${response.status})`);
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
    },
    advanced: {
      useSecureCookies: isProductionOrigin,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      crossSubDomainCookies: isProductionOrigin
        ? { enabled: true, domain: ".itemtraxx.com" }
        : { enabled: false },
      database: { generateId: () => crypto.randomUUID() },
    },
    onAPIError: {
      errorURL: "https://itemtraxx.com/login",
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
          if (!["/sso/register", "/sso/update-provider", "/sso/delete-provider", "/sso/verify-domain", "/sso/request-domain-verification"].includes(context.path)) return;
          const session = await getSessionFromCtx(context);
          if (!session) throw new APIError("UNAUTHORIZED");
          const { data: profileRow, error: profileError } = await dataClient.schema("public").from("profiles")
            .select("role,workspace_id,workspaces!profiles_workspace_id_fkey(better_auth_organization_id)")
            .eq("better_auth_user_id", session.user.id).eq("is_active", true).is("deleted_at", null).maybeSingle();
          if (profileError) throw profileError;
          const workspace = Array.isArray(profileRow?.workspaces) ? profileRow.workspaces[0] : profileRow?.workspaces;
          const profile = profileRow ? { role: profileRow.role, organization_id: workspace?.better_auth_organization_id ?? null } : null;
          if (!profile || !["workspace_admin", "super_admin"].includes(profile.role)) {
            throw new APIError("FORBIDDEN");
          }
          let targetOrganizationId = typeof context.body?.organizationId === "string"
            ? context.body.organizationId
            : null;
          if (!targetOrganizationId && typeof context.body?.providerId === "string") {
            const { data: provider, error } = await dataClient.schema("better_auth").from("ssoProvider")
              .select("organizationId").eq("providerId", context.body.providerId).maybeSingle();
            if (error) throw error;
            targetOrganizationId = provider?.organizationId ?? null;
          }
          if (!targetOrganizationId) throw new APIError("BAD_REQUEST", { message: "An ItemTraxx workspace organization is required" });
          if (profile.role === "workspace_admin" && targetOrganizationId !== profile.organization_id) {
            throw new APIError("FORBIDDEN");
          }
          if (context.path === "/sso/register") context.body.organizationId = targetOrganizationId;
        }),
    },
    plugins: [
      organization({
        ac: organizationAccess,
        roles: organizationRoles,
        allowUserToCreateOrganization: false,
        creatorRole: "workspace_admin",
      }),
      admin({
        ac: globalAccess,
        roles: globalRoles,
        defaultRole: "user",
        adminRoles: ["super_admin"],
        allowImpersonatingAdmins: false,
      }),
      passkey({
        rpID: env.BETTER_AUTH_PASSKEY_RP_ID,
        rpName: "ItemTraxx",
        origin: passkeyOrigins.length === 1 ? passkeyOrigins[0] : passkeyOrigins,
      }),
      twoFactor({ issuer: "ItemTraxx", skipVerificationOnEnable: false }),
      sso({
        domainVerification: { enabled: true },
        organizationProvisioning: {
          disabled: false,
          defaultRole: "member",
          getRole: async ({ user, provider }) => {
            if (!provider.organizationId) throw new Error("SSO provider is not linked to an ItemTraxx workspace");
            const { data: existing, error } = await dataClient.schema("public").from("profiles")
              .select("workspace_id,workspaces!profiles_workspace_id_fkey(better_auth_organization_id)")
              .eq("better_auth_user_id", user.id).maybeSingle();
            if (error) throw error;
            const existingWorkspace = Array.isArray(existing?.workspaces) ? existing.workspaces[0] : existing?.workspaces;
            if (existing && existingWorkspace?.better_auth_organization_id !== provider.organizationId) {
              throw new Error("SSO identity is already assigned to another ItemTraxx workspace");
            }
            return "member";
          },
        },
        provisionUser: async ({ user, provider }) => {
          if (!provider.organizationId) throw new Error("SSO provider is not linked to an ItemTraxx workspace");
          const { data: workspace, error: workspaceError } = await dataClient.schema("public").from("workspaces")
            .select("id").eq("better_auth_organization_id", provider.organizationId).eq("status", "active").maybeSingle();
          if (workspaceError) throw workspaceError;
          if (!workspace?.id) throw new Error("SSO workspace is unavailable");
          const { data: existing, error: existingError } = await dataClient.schema("public").from("profiles")
            .select("workspace_id,role").eq("better_auth_user_id", user.id).maybeSingle();
          if (existingError) throw existingError;
          if (
            existing &&
            (existing.workspace_id !== workspace.id || existing.role !== "tenant_account")
          ) {
            throw new Error("SSO identity is already assigned to a different ItemTraxx security boundary");
          }
          if (existing) {
            const { error } = await dataClient.schema("public").from("profiles").update({ auth_email: user.email })
              .eq("better_auth_user_id", user.id).eq("workspace_id", workspace.id).eq("role", "tenant_account");
            if (error) throw error;
          } else {
            const { error } = await dataClient.schema("public").from("profiles").insert({
              id: crypto.randomUUID(), better_auth_user_id: user.id, workspace_id: workspace.id,
              auth_email: user.email, role: "tenant_account", is_active: true,
            });
            if (error) throw error;
          }
        },
        saml: {
          clockSkew: 60_000,
          requireTimestamps: true,
          algorithms: { onDeprecated: "reject" },
        },
      }),
      jwt({
        jwks: {
          remoteUrl: `${env.BETTER_AUTH_URL}/api/auth/.well-known/jwks.json`,
          keyPairConfig: { alg: "ES256" },
        },
        jwt: {
          issuer: env.BETTER_AUTH_JWT_ISSUER,
          audience: env.BETTER_AUTH_JWT_AUDIENCE,
          expirationTime: "5m",
          definePayload: ({ user, session }) => ({
            role: "authenticated",
            email: user.email,
            session_id: session.id,
            aal: "aal1",
            amr: [{ method: "session", timestamp: Math.floor(new Date(session.createdAt).getTime() / 1000) }],
          }),
          getSubject: async ({ user }) => {
            const { data: result, error } = await dataClient.schema("public").from("profiles")
              .select("id").eq("better_auth_user_id", user.id).eq("is_active", true).is("deleted_at", null).maybeSingle();
            if (error) throw error;
            const profileId = result?.id;
            if (!profileId) throw new Error("Better Auth user is not linked to an active ItemTraxx profile");
            return profileId;
          },
          sign: (payload, header) => signSupabaseJwt(env, payload, header),
        },
      }),
      ...(env.BETTER_AUTH_TURNSTILE_SECRET_KEY ? [captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.BETTER_AUTH_TURNSTILE_SECRET_KEY,
        endpoints: ["/sign-in/email", "/request-password-reset"],
      })] : []),
      ...(env.BETTER_AUTH_API_KEY ? [dash({ apiKey: env.BETTER_AUTH_API_KEY })] : []),
    ],
  });
  cachedKey = cacheKey;
  return cachedAuth;
};

const parseStoredJson = (value: string | null) => {
  if (!value) return null;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
};

export const handleSsoManagementRequest = async (request: Request, rawEnv: Env) => {
  const auth = getBetterAuth(rawEnv);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || !cachedDataClient) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: actorProfile, error: actorError } = await cachedDataClient.schema("public").from("profiles")
    .select("role,workspace_id").eq("better_auth_user_id", session.user.id).eq("is_active", true).is("deleted_at", null).maybeSingle();
  if (actorError) throw actorError;
  let actorOrganizationId: string | null = null;
  if (actorProfile?.workspace_id) {
    const { data: workspace, error } = await cachedDataClient.schema("public").from("workspaces")
      .select("better_auth_organization_id").eq("id", actorProfile.workspace_id).maybeSingle();
    if (error) throw error;
    actorOrganizationId = workspace?.better_auth_organization_id ?? null;
  }
  const actor = actorProfile ? { role: actorProfile.role, organization_id: actorOrganizationId } : null;
  if (!actor || !["workspace_admin", "super_admin"].includes(actor.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get("organizationId");
  if (actor.role === "workspace_admin" && requestedOrganizationId && requestedOrganizationId !== actor.organization_id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const organizationId = actor.role === "workspace_admin" ? actor.organization_id : requestedOrganizationId;
  if (request.method === "GET") {
    let providerQuery = cachedDataClient.schema("better_auth").from("ssoProvider")
      .select("providerId,issuer,domain,domainVerified,organizationId,oidcConfig,samlConfig").order("domain").order("providerId");
    if (organizationId) providerQuery = providerQuery.eq("organizationId", organizationId);
    const { data: providers, error: providersError } = await providerQuery;
    if (providersError) throw providersError;
    let workspaces: Array<{ id: string; name: string; organizationId: string | null }> = [];
    if (actor.role === "super_admin") {
      const { data, error } = await cachedDataClient.schema("public").from("workspaces")
        .select("id,name,better_auth_organization_id").is("archived_at", null).order("name");
      if (error) throw error;
      workspaces = (data ?? []).map((row) => ({ id: row.id, name: row.name, organizationId: row.better_auth_organization_id }));
    }
    return Response.json({ organizationId: actor.organization_id, workspaces, providers: (providers ?? []).map((row) => {
      const oidc = parseStoredJson(row.oidcConfig);
      if (oidc) delete oidc.clientSecret;
      return { ...row, oidcConfig: oidc, samlConfig: parseStoredJson(row.samlConfig) };
    }) });
  }
  if (request.method === "DELETE") {
    const providerId = url.searchParams.get("providerId");
    if (!providerId) return Response.json({ error: "providerId is required" }, { status: 400 });
    const { data: target, error } = await cachedDataClient.schema("better_auth").from("ssoProvider")
      .select("organizationId").eq("providerId", providerId).maybeSingle();
    if (error) throw error;
    if (!target) return Response.json({ error: "Not found" }, { status: 404 });
    if (actor.role === "workspace_admin" && target.organizationId !== actor.organization_id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const { error: deleteError } = await cachedDataClient.schema("better_auth").from("ssoProvider").delete().eq("providerId", providerId);
    if (deleteError) throw deleteError;
    return Response.json({ success: true });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

const constantTimeSecretMatches = async (provided: string, expected: string) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(expected), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const [left, right] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(provided)),
    crypto.subtle.sign("HMAC", key, encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left), b = new Uint8Array(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

export const handleInternalAuthAdminRequest = async (request: Request, rawEnv: Env) => {
  const env = rawEnv as BetterAuthEnv;
  if (!env.ITX_INTERNAL_AUTH_SECRET) return Response.json({ error: "Unavailable" }, { status: 503 });
  const provided = request.headers.get("x-itx-internal-auth") ?? "";
  if (!provided || !await constantTimeSecretMatches(provided, env.ITX_INTERNAL_AUTH_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  getBetterAuth(env);
  if (!cachedDataClient) return Response.json({ error: "Unavailable" }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const profileId = typeof body?.profileId === "string" ? body.profileId : "";
  try {
    if (action === "create_organization") {
      const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
      if (!workspaceId || !name || !slug) return Response.json({ error: "Invalid request" }, { status: 400 });
      const organizationId = workspaceId;
      const { error } = await cachedDataClient.schema("public").rpc("better_auth_create_organization", {
        p_workspace_id: workspaceId, p_name: name, p_slug: slug,
      });
      if (error) throw error;
      return Response.json({ organization: { id: organizationId } });
    }
    if (action === "delete_organization") {
      const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
      if (!organizationId) return Response.json({ error: "Invalid request" }, { status: 400 });
      const { error } = await cachedDataClient.schema("better_auth").from("organization").delete().eq("id", organizationId);
      if (error) throw error;
      return Response.json({ success: true });
    }
    if (action === "create_user") {
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : email;
      const role = body?.role === "super_admin" ? "super_admin" : "user";
      const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : null;
      if (!profileId || !email || password.length < 12) return Response.json({ error: "Invalid request" }, { status: 400 });
      const userId = crypto.randomUUID(), accountId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);
      const memberRole = body?.profileRole === "workspace_admin" ? "workspace_admin" : "tenant_account";
      const { error } = await cachedDataClient.schema("public").rpc("better_auth_create_user", {
        p_profile_id: profileId, p_user_id: userId, p_account_id: accountId,
        p_email: email, p_name: name, p_global_role: role, p_password_hash: passwordHash,
        p_workspace_id: workspaceId, p_member_id: workspaceId ? crypto.randomUUID() : null,
        p_member_role: workspaceId ? memberRole : null,
      });
      if (error) throw error;
      return Response.json({ user: { id: profileId, betterAuthUserId: userId, email } });
    }
    const explicitBetterAuthUserId = typeof body?.betterAuthUserId === "string" ? body.betterAuthUserId : "";
    const { data: profileMapping, error: mappingError } = await cachedDataClient.schema("public").from("profiles")
      .select("better_auth_user_id").eq("id", profileId).maybeSingle();
    if (mappingError) throw mappingError;
    const userIdForLookup = profileMapping?.better_auth_user_id ?? explicitBetterAuthUserId;
    const { data: userMapping, error: userError } = userIdForLookup
      ? await cachedDataClient.schema("better_auth").from("user").select("id,email").eq("id", userIdForLookup).maybeSingle()
      : { data: null, error: null };
    if (userError) throw userError;
    const target = userMapping ? { user_id: userMapping.id, email: userMapping.email } : undefined;
    if (!target) return Response.json({ error: "User not found" }, { status: 404 });
    if (action === "update_email") {
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!email) return Response.json({ error: "Invalid email" }, { status: 400 });
      const { error } = await cachedDataClient.schema("better_auth").from("user")
        .update({ email, updatedAt: new Date().toISOString() }).eq("id", target.user_id);
      if (error) throw error;
      return Response.json({ success: true });
    }
    if (action === "delete_user") {
      const { error } = await cachedDataClient.schema("better_auth").from("user").delete().eq("id", target.user_id);
      if (error) throw error;
      return Response.json({ success: true });
    }
    if (action === "revoke_sessions") {
      const { error } = await cachedDataClient.schema("better_auth").from("session").delete().eq("userId", target.user_id);
      if (error) throw error;
      return Response.json({ success: true });
    }
    if (action === "verify_password") {
      const password = typeof body?.password === "string" ? body.password : "";
      const { data: account, error } = await cachedDataClient.schema("better_auth").from("account")
        .select("password").eq("userId", target.user_id).eq("providerId", "credential").maybeSingle();
      if (error) throw error;
      return Response.json({ verified: Boolean(account?.password && await verifyPassword({ hash: account.password, password })) });
    }
    if (action === "list_passkeys") {
      const { data: passkeys, error } = await cachedDataClient.schema("better_auth").from("passkey")
        .select("id,name,createdAt").eq("userId", target.user_id).order("createdAt", { ascending: false });
      if (error) throw error;
      return Response.json({ passkeys: (passkeys ?? []).map((row) => ({ id: row.id, name: row.name, created_at: row.createdAt })) });
    }
    if (action === "delete_passkey") {
      const passkeyId = typeof body?.passkeyId === "string" ? body.passkeyId : "";
      const { data: deleted, error } = await cachedDataClient.schema("better_auth").from("passkey")
        .delete().eq("id", passkeyId).eq("userId", target.user_id).select("id");
      if (error) throw error;
      return Response.json({ success: (deleted?.length ?? 0) === 1 });
    }
    if (action === "request_password_reset") {
      await getBetterAuth(env).api.requestPasswordReset({ body: { email: target.email, redirectTo: `${env.BETTER_AUTH_URL.replace(/\/+$/, "")}/reset-password` } });
      return Response.json({ success: true });
    }
    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (cause) {
    console.error("Internal Better Auth administration failed", cause instanceof Error ? cause.message : "unknown error");
    return Response.json({ error: "Request failed" }, { status: 500 });
  }
};

export const handleBetterAuthRequest = (request: Request, rawEnv: Env) => {
  const env = rawEnv as BetterAuthEnv;
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/.well-known/jwks.json") {
    const publicJwk = parseJwk(env.BETTER_AUTH_JWT_PUBLIC_JWK, "BETTER_AUTH_JWT_PUBLIC_JWK");
    return Response.json({ keys: [{ ...publicJwk, use: "sig", alg: "ES256" }] });
  }
  return getBetterAuth(env).handler(request);
};

export const getSupabaseAccessToken = async (request: Request, env: Env) => {
  const result = await getBetterAuth(env).api.getToken({ headers: request.headers });
  return result?.token ?? null;
};
