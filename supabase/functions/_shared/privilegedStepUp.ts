import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

export type PrivilegedRoleScope =
  | "super_admin"
  | "tenant_admin"
  | "district_admin";

type PgLikeError = {
  code?: string;
  message?: string;
};

const DEFAULT_STEP_UP_TTL_MS = 15 * 60 * 1000;
const ADMIN_STEP_UP_REGISTRATION_WINDOW_MS = 5 * 60 * 1000;
const ADMIN_HANDOFF_AUTH_METHODS = new Set([
  "magiclink",
  "magic_link",
  "otp",
  "email_link",
]);

const sha256 = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const getVerifiedClaims = async (
  authClient: SupabaseClient,
  authToken: string,
) => {
  const { data, error } = await authClient.auth.getClaims(authToken);
  if (error || !data?.claims) {
    throw new Error("Unable to verify authentication claims.");
  }
  return data.claims as Record<string, unknown>;
};

const resolveBindingKey = async (
  authClient: SupabaseClient,
  authToken: string,
) => {
  const payload = await getVerifiedClaims(authClient, authToken);
  const sessionId = typeof payload?.session_id === "string"
    ? payload.session_id.trim()
    : "";
  if (sessionId) {
    return `session:${sessionId}`;
  }
  return `token:${await sha256(authToken)}`;
};

export const canRegisterAdminStepUp = async (
  authClient: SupabaseClient,
  authToken: string,
) => {
  const payload = await getVerifiedClaims(authClient, authToken);
  const issuedAt = typeof payload?.iat === "number" ? payload.iat * 1000 : null;
  if (!issuedAt || Number.isNaN(issuedAt)) return false;

  const ageMs = Date.now() - issuedAt;
  return ageMs >= -30_000 && ageMs <= ADMIN_STEP_UP_REGISTRATION_WINDOW_MS;
};

export const canRegisterAdminStepUpFromTrustedHandoff = async (
  authClient: SupabaseClient,
  authToken: string,
) => {
  if (!await canRegisterAdminStepUp(authClient, authToken)) return false;

  const payload = await getVerifiedClaims(authClient, authToken);
  const amr = Array.isArray(payload?.amr) ? payload.amr : [];
  return amr.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const method = (entry as { method?: unknown }).method;
    return typeof method === "string" &&
      ADMIN_HANDOFF_AUTH_METHODS.has(method.toLowerCase());
  });
};

export const isMissingPrivilegedStepUpTable = (
  error: PgLikeError | null | undefined,
) =>
  !!error &&
  error.code === "42P01" &&
  (error.message ?? "").toLowerCase().includes("privileged_session_stepups");

export const registerPrivilegedStepUp = async (
  adminClient: SupabaseClient,
  options: {
    userId: string;
    roleScope: PrivilegedRoleScope;
    authToken: string;
    source: string;
    ttlMs?: number;
  },
) => {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (options.ttlMs ?? DEFAULT_STEP_UP_TTL_MS),
  ).toISOString();
  const bindingKey = await resolveBindingKey(adminClient, options.authToken);

  const { error } = await adminClient.from("privileged_session_stepups").upsert(
    {
      user_id: options.userId,
      role_scope: options.roleScope,
      binding_key: bindingKey,
      issued_by: options.source,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      expires_at: expiresAt,
    },
    { onConflict: "user_id,role_scope,binding_key" },
  );

  if (error) {
    throw error;
  }

  return { expiresAt };
};

export const hasPrivilegedStepUp = async (
  adminClient: SupabaseClient,
  options: {
    userId: string;
    roleScope: PrivilegedRoleScope;
    authToken: string;
  },
) => {
  const bindingKey = await resolveBindingKey(adminClient, options.authToken);
  const { data, error } = await adminClient
    .from("privileged_session_stepups")
    .select("id")
    .eq("user_id", options.userId)
    .eq("role_scope", options.roleScope)
    .eq("binding_key", bindingKey)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return !!data?.id;
};
