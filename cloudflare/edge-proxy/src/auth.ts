import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { admin, captcha, jwt, organization, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { dash, sentinel } from "@better-auth/infra";
import { importJWK, SignJWT, type JWK, type JWTPayload } from "jose";
import {
  globalAccess,
  globalRoles,
  organizationAccess,
  organizationRoles,
} from "./auth/permissions.ts";
import { parseCsv } from "./cors.ts";
import { isItemTraxxHostname, trimTrailingSlash } from "./url.ts";
import {
  createBetterAuthDataClient,
  supabaseBetterAuthAdapter,
} from "./supabaseBetterAuthAdapter.ts";
import { resolveInternalAuthAdminTarget } from "./authAdmin.ts";
import {
  getPasswordResetDelivery,
  sendPasswordResetEmail,
} from "./passwordResetDelivery.ts";
import { recordPasskeyUsage } from "./passkeyUsage.ts";
import { normalizeBetterAuthCaptchaRequest } from "./authCaptcha.ts";

export { normalizeBetterAuthCaptchaRequest } from "./authCaptcha.ts";

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
  ITX_RESEND_API_KEY?: string;
  ITX_RESEND_FROM?: string;
  ITX_EMAIL_NOTIFICATIONS?: string;
  ITX_EMAIL_NOREPLY?: string;
  ITX_EMAIL_FROM?: string;
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

type BetterAuthSessionLike = {
  user?: { id?: string };
  session?: { id?: string };
};

type SsoActor = {
  profileId: string;
  role: string;
  workspaceId: string | null;
  organizationId: string | null;
  workspaceStatus: string | null;
};

const resolveSsoActor = async (
  dataClient: ReturnType<typeof createBetterAuthDataClient>,
  betterAuthUserId: string,
): Promise<SsoActor | null> => {
  const { data, error } = await dataClient.schema("public").from("profiles")
    .select("id,role,workspace_id,workspaces!profiles_workspace_id_fkey(better_auth_organization_id,status)")
    .eq("better_auth_user_id", betterAuthUserId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || typeof data.role !== "string") return null;
  const workspace = Array.isArray(data.workspaces) ? data.workspaces[0] : data.workspaces;
  return {
    profileId: data.id,
    role: data.role,
    workspaceId: data.workspace_id ?? null,
    organizationId: workspace?.better_auth_organization_id ?? null,
    workspaceStatus: workspace?.status ?? null,
  };
};

const hasSsoSessionGrant = async (
  dataClient: ReturnType<typeof createBetterAuthDataClient>,
  actor: SsoActor,
  sessionId: string,
) => {
  const { data, error } = await dataClient.schema("public")
    .from("privileged_session_stepups")
    .select("id")
    .eq("user_id", actor.profileId)
    .eq("role_scope", actor.role)
    .eq("binding_key", `session:${sessionId}`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data?.id;
};

const hasRevokedSsoSession = async (
  dataClient: ReturnType<typeof createBetterAuthDataClient>,
  actor: SsoActor,
  sessionId: string,
) => {
  const table = actor.role === "super_admin" ? "super_admin_sessions" : "account_sessions";
  let query = dataClient.schema("public").from(table).select("id")
    .eq("profile_id", actor.profileId)
    .eq("auth_session_id", sessionId);
  if (actor.role !== "super_admin" && actor.workspaceId) {
    query = query.eq("workspace_id", actor.workspaceId);
  }
  const { data, error } = await query.not("revoked_at", "is", null).limit(1).maybeSingle();
  if (error) throw error;
  return !!data?.id;
};

const isSsoSessionAuthorized = async (
  dataClient: ReturnType<typeof createBetterAuthDataClient>,
  session: BetterAuthSessionLike,
) => {
  const betterAuthUserId = session.user?.id?.trim();
  const sessionId = session.session?.id?.trim();
  if (!betterAuthUserId || !sessionId) return false;
  const actor = await resolveSsoActor(dataClient, betterAuthUserId);
  if (!actor || !["workspace_admin", "super_admin"].includes(actor.role)) return false;
  if (actor.role === "workspace_admin" && actor.workspaceStatus !== "active") return false;
  if (await hasRevokedSsoSession(dataClient, actor, sessionId)) return false;
  return await hasSsoSessionGrant(dataClient, actor, sessionId);
};

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
  const isProductionOrigin = configuredUrl.protocol === "https:" && isItemTraxxHostname(configuredUrl.hostname);
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
      sendResetPassword: async ({ user, url }, request) =>
        sendPasswordResetEmail({ env, user, url, request }),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 0, // An active session should not trigger periodic re-authentication.
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
          if (context.path === "/organization/update") {
            const session = await getSessionFromCtx(context);
            if (!session) throw new APIError("UNAUTHORIZED");
            const organizationId = typeof context.body?.organizationId === "string"
              ? context.body.organizationId
              : null;
            if (!organizationId) {
              throw new APIError("BAD_REQUEST", {
                message: "An organization ID is required to update organization settings.",
              });
            }
            const { data: member, error: memberError } = await dataClient.schema("better_auth")
              .from("member")
              .select("role")
              .eq("userId", session.user.id)
              .eq("organizationId", organizationId)
              .maybeSingle();
            if (memberError) throw memberError;
            if (!member || !["workspace_admin", "admin"].includes(member.role)) {
              throw new APIError("FORBIDDEN");
            }
            const { data: workspace, error } = await dataClient.schema("public")
              .from("workspaces")
              .select("status,archived_at")
              .eq("better_auth_organization_id", organizationId)
              .maybeSingle();
            if (error) throw error;
            if (!workspace || workspace.status !== "active" || workspace.archived_at) {
              throw new APIError("FORBIDDEN", {
                message: "Organization settings are unavailable for this workspace.",
              });
            }
            return;
          }
          if (!["/sso/register", "/sso/update-provider", "/sso/delete-provider", "/sso/verify-domain", "/sso/request-domain-verification"].includes(context.path)) return;
          const session = await getSessionFromCtx(context);
          if (!session) throw new APIError("UNAUTHORIZED");
          const authorized = await isSsoSessionAuthorized(dataClient, session as BetterAuthSessionLike);
          if (!authorized) {
            throw new APIError("FORBIDDEN");
          }
          const actor = await resolveSsoActor(dataClient, session.user.id);
          if (!actor) throw new APIError("FORBIDDEN");
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
          if (actor.role === "workspace_admin" && targetOrganizationId !== actor.organizationId) {
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
        organizationHooks: {
          beforeUpdateOrganization: async ({ organization }) => {
            // Slugs determine workspace hostnames and stay managed outside
            // organization settings for every organization member.
            if ("slug" in organization) {
              throw new APIError("FORBIDDEN", {
                message: "Organization slugs are managed separately.",
              });
            }
          },
        },
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
        authentication: {
          afterVerification: async ({ ctx, clientData }) => {
            await recordPasskeyUsage({
              adapter: ctx.context.adapter,
              logger: ctx.context.logger,
              credentialId: clientData.id,
            });
          },
        },
      }),
      twoFactor({ issuer: "ItemTraxx", skipVerificationOnEnable: false }),
      sentinel({ apiKey: env.BETTER_AUTH_API_KEY }),
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

export const sanitizeSsoProvider = (row: {
  providerId: string;
  issuer: string;
  domain: string;
  domainVerified: boolean;
  organizationId: string | null;
  oidcConfig: string | null;
  samlConfig: string | null;
}) => ({
  providerId: row.providerId,
  issuer: row.issuer,
  domain: row.domain,
  domainVerified: row.domainVerified,
  organizationId: row.organizationId,
  // The UI only needs protocol presence. Never send client secrets, signing
  // keys, certificates, or other provider configuration to the browser.
  oidcConfig: parseStoredJson(row.oidcConfig) ? {} : null,
  samlConfig: parseStoredJson(row.samlConfig) ? {} : null,
});

export const handleSsoManagementRequest = async (request: Request, rawEnv: Env) => {
  const auth = getBetterAuth(rawEnv);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || !cachedDataClient) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const actor = await resolveSsoActor(cachedDataClient, session.user.id);
  const authorized = actor && await isSsoSessionAuthorized(cachedDataClient, session as BetterAuthSessionLike);
  if (!actor || !authorized) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get("organizationId");
  if (actor.role === "workspace_admin" && requestedOrganizationId && requestedOrganizationId !== actor.organizationId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const organizationId = actor.role === "workspace_admin" ? actor.organizationId : requestedOrganizationId;
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
    return Response.json({ organizationId: actor.organizationId, workspaces, providers: (providers ?? []).map(sanitizeSsoProvider) });
  }
  if (request.method === "DELETE") {
    const providerId = url.searchParams.get("providerId");
    if (!providerId) return Response.json({ error: "providerId is required" }, { status: 400 });
    const { data: target, error } = await cachedDataClient.schema("better_auth").from("ssoProvider")
      .select("organizationId").eq("providerId", providerId).maybeSingle();
    if (error) throw error;
    if (!target) return Response.json({ error: "Not found" }, { status: 404 });
    if (actor.role === "workspace_admin" && target.organizationId !== actor.organizationId) {
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

const resolvePasswordResetRedirect = (env: BetterAuthEnv, requested: unknown) => {
  const configured = typeof requested === "string" && requested.trim()
    ? requested.trim()
    : isItemTraxxHostname(new URL(env.BETTER_AUTH_URL).hostname)
    ? "https://itemtraxx.com/reset-password"
    : `${trimTrailingSlash(env.BETTER_AUTH_URL)}/reset-password`;
  const redirect = new URL(configured);
  const isLocal = ["localhost", "127.0.0.1"].includes(redirect.hostname);
  if (
    redirect.pathname !== "/reset-password" || redirect.search || redirect.hash ||
    (!isItemTraxxHostname(redirect.hostname) && !(isLocal && redirect.protocol === "http:")) ||
    (isItemTraxxHostname(redirect.hostname) && redirect.protocol !== "https:")
  ) {
    throw new Error("Invalid password reset redirect");
  }
  return redirect.toString();
};

const ORGANIZATION_LOGO_PREFIX = "organization-logos";
const ORGANIZATION_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const ORGANIZATION_LOGO_TYPES = {
  "image/png": { extension: "png" },
  "image/jpeg": { extension: "jpg" },
  "image/webp": { extension: "webp" },
} as const;

const isAllowedOrganizationLogoRequest = (request: Request, allowedOrigins: string[]) => {
  const origin = request.headers.get("Origin");
  if (origin) return allowedOrigins.includes(origin);

  // Ordinary <img> requests do not send Origin. Their Referer is limited to
  // the source origin by the app's strict-origin-when-cross-origin policy.
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return allowedOrigins.includes(new URL(referer).origin);
  } catch {
    return false;
  }
};

const readRequestBodyWithLimit = async (request: Request, maxBytes: number) => {
  const reader = request.body?.getReader();
  if (!reader) return { body: new Uint8Array(), tooLarge: false };

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { body: null, tooLarge: true };
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, tooLarge: false };
};

const hasSupportedImageSignature = (contentType: keyof typeof ORGANIZATION_LOGO_TYPES, bytes: Uint8Array) => {
  if (contentType === "image/png") {
    return bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
};

export const handleOrganizationLogoUpload = async (
  request: Request,
  rawEnv: Env,
  organizationId: string,
) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
    return Response.json({ error: "Invalid organization" }, { status: 400 });
  }

  const env = rawEnv as BetterAuthEnv;
  if (!env.ORGANIZATION_LOGOS) {
    return Response.json({ error: "Logo storage is unavailable" }, { status: 503 });
  }

  const auth = getBetterAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || !cachedDataClient) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: member, error: memberError } = await cachedDataClient
    .schema("better_auth")
    .from("member")
    .select("role")
    .eq("userId", session.user.id)
    .eq("organizationId", organizationId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member || !["workspace_admin", "admin"].includes(member.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: workspace, error: workspaceError } = await cachedDataClient
    .schema("public")
    .from("workspaces")
    .select("id,status,archived_at")
    .eq("better_auth_organization_id", organizationId)
    .maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace || workspace.status !== "active" || workspace.archived_at) {
    return Response.json({ error: "Workspace is unavailable" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!contentType || !Object.prototype.hasOwnProperty.call(ORGANIZATION_LOGO_TYPES, contentType)) {
    return Response.json({ error: "Choose a PNG, JPEG, or WebP image." }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > ORGANIZATION_LOGO_MAX_BYTES) {
    return Response.json({ error: "Logo images must be 2 MB or smaller." }, { status: 413 });
  }
  const { body, tooLarge } = await readRequestBodyWithLimit(request, ORGANIZATION_LOGO_MAX_BYTES);
  if (tooLarge) {
    return Response.json({ error: "Logo images must be 2 MB or smaller." }, { status: 413 });
  }
  if (!body?.length || !hasSupportedImageSignature(contentType as keyof typeof ORGANIZATION_LOGO_TYPES, body)) {
    return Response.json({ error: "The selected file is not a supported image." }, { status: 400 });
  }

  const { extension } = ORGANIZATION_LOGO_TYPES[contentType as keyof typeof ORGANIZATION_LOGO_TYPES];
  const fileName = `logo-${crypto.randomUUID()}.${extension}`;
  const objectPath = `${ORGANIZATION_LOGO_PREFIX}/${organizationId}/${fileName}`;
  try {
    await env.ORGANIZATION_LOGOS.put(objectPath, body, {
      httpMetadata: {
        contentType,
        contentDisposition: "inline",
        cacheControl: "private, max-age=300",
      },
      customMetadata: { organizationId },
    });
  } catch (error) {
    console.error("Organization logo upload failed", error);
    return Response.json({ error: "Unable to save the organization logo." }, { status: 502 });
  }

  const logoUrl = `${trimTrailingSlash(env.BETTER_AUTH_URL)}/api/organization/${organizationId}/logo/${fileName}`;
  return Response.json({ logoUrl }, { headers: { "Cache-Control": "no-store" } });
};

export const handleOrganizationLogoRead = async (
  request: Request,
  rawEnv: Env,
  organizationId: string,
  fileName: string,
  allowedOrigins: string[],
) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId) ||
    !/^logo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/i.test(fileName)) {
    return Response.json({ error: "Invalid organization logo" }, { status: 400 });
  }
  if (!isAllowedOrganizationLogoRequest(request, allowedOrigins)) {
    return Response.json({ error: "Organization logo access is restricted" }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const bucket = rawEnv.ORGANIZATION_LOGOS;
  if (!bucket) {
    return Response.json({ error: "Logo storage is unavailable" }, { status: 503 });
  }

  const object = await bucket.get(`${ORGANIZATION_LOGO_PREFIX}/${organizationId}/${fileName}`);
  if (!object) return new Response(null, { status: 404 });

  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
    "Content-Disposition": "inline",
    "Cache-Control": "private, max-age=300",
    "Cross-Origin-Resource-Policy": "same-site",
    "X-Content-Type-Options": "nosniff",
  });
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
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
      const memberRole = body?.profileRole === "workspace_admin"
        ? "workspace_admin"
        : body?.profileRole === "individual_account"
        ? "individual_account"
        : "tenant_account";
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
    const target = await resolveInternalAuthAdminTarget({
      dataClient: cachedDataClient,
      action,
      profileId,
      explicitBetterAuthUserId,
    });
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
      let { data: passkeys, error } = await cachedDataClient.schema("better_auth").from("passkey")
        .select("id,name,createdAt,lastUsedAt").eq("userId", target.user_id).order("createdAt", { ascending: false });
      // Keep the inventory endpoint compatible during a rolling deployment in
      // which the Worker is updated before the nullable metadata column. The
      // authentication hook is already best-effort, so older rows can safely
      // be listed as unrecorded until the migration is applied.
      if (error?.code === "42703" && /lastUsedAt/i.test(error.message ?? "")) {
        const fallback = await cachedDataClient.schema("better_auth").from("passkey")
          .select("id,name,createdAt").eq("userId", target.user_id).order("createdAt", { ascending: false });
        passkeys = fallback.data?.map((row) => ({ ...row, lastUsedAt: null })) ?? null;
        error = fallback.error;
      }
      if (error) throw error;
      return Response.json({ passkeys: (passkeys ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        created_at: row.createdAt,
        last_used_at: row.lastUsedAt ?? null,
      })) });
    }
    if (action === "delete_passkey") {
      const passkeyId = typeof body?.passkeyId === "string" ? body.passkeyId : "";
      const { data: deleted, error } = await cachedDataClient.schema("better_auth").from("passkey")
        .delete().eq("id", passkeyId).eq("userId", target.user_id).select("id");
      if (error) throw error;
      return Response.json({ success: (deleted?.length ?? 0) === 1 });
    }
    if (action === "request_password_reset") {
      // Better Auth's direct API call accepts a Request so the reset callback
      // can record delivery against this invocation. This request carries no
      // user-controlled body; the validated payload below remains authoritative.
      const authRequest = new Request(request.url, {
        method: "POST",
        headers: request.headers,
      });
      await getBetterAuth(env).api.requestPasswordReset({
        body: {
          email: target.email,
          redirectTo: resolvePasswordResetRedirect(env, body?.redirectTo),
        },
        request: authRequest,
      });
      const delivery = getPasswordResetDelivery(authRequest);
      if (delivery?.status !== "sent") {
        throw new Error(
          delivery?.message ?? "Password reset email delivery did not complete",
        );
      }
      return Response.json({ success: true });
    }
    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (cause) {
    console.error("Internal Better Auth administration failed", cause instanceof Error ? cause.message : "unknown error");
    return Response.json({ error: "Request failed" }, { status: 500 });
  }
};

export const handleBetterAuthRequest = async (request: Request, rawEnv: Env) => {
  const env = rawEnv as BetterAuthEnv;
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/.well-known/jwks.json") {
    const publicJwk = parseJwk(env.BETTER_AUTH_JWT_PUBLIC_JWK, "BETTER_AUTH_JWT_PUBLIC_JWK");
    return Response.json({ keys: [{ ...publicJwk, use: "sig", alg: "ES256" }] });
  }
  // Keep Better Auth's generic reset response for public requests so an email
  // delivery failure cannot be used to enumerate registered accounts. The
  // internal administration bridge above checks the delivery outcome and
  // returns an actionable failure to trusted callers instead.
  return getBetterAuth(env).handler(await normalizeBetterAuthCaptchaRequest(request));
};

export const getSupabaseAccessToken = async (request: Request, env: Env) => {
  const result = await getBetterAuth(env).api.getToken({ headers: request.headers });
  return result?.token ?? null;
};
