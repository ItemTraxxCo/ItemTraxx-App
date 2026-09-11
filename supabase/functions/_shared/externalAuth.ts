import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.3";

type AuthenticatedClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: { id?: string; auth_email?: string | null } | null; error: unknown }>;
      };
    };
  };
};

let cachedJwksUrl = "";
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export const verifyExternalAuthClaims = async (authorization: string) => {
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const jwksUrl = Deno.env.get("BETTER_AUTH_JWKS_URL")?.trim();
  const issuer = Deno.env.get("BETTER_AUTH_JWT_ISSUER")?.trim();
  const audience = Deno.env.get("BETTER_AUTH_JWT_AUDIENCE")?.trim();
  if (!token || !jwksUrl || !issuer || !audience) return null;
  try {
    if (!cachedJwks || cachedJwksUrl !== jwksUrl) {
      cachedJwks = createRemoteJWKSet(new URL(jwksUrl));
      cachedJwksUrl = jwksUrl;
    }
    const { payload } = await jwtVerify(token, cachedJwks, {
      issuer,
      audience,
      algorithms: ["ES256"],
    });
    return typeof payload.sub === "string" ? payload : null;
  } catch {
    return null;
  }
};

/**
 * Resolve a Better Auth subject only after Supabase has verified the imported
 * signing key and RLS has allowed the caller to read its own profile row.
 * The decoded JWT subject is never trusted on its own.
 */
export const getExternalAuthUser = async (
  rawClient: unknown,
  authorization: string,
) => {
  const client = rawClient as AuthenticatedClient;
  const claims = await verifyExternalAuthClaims(authorization);
  const subject = claims?.sub;
  if (!subject) return { data: { user: null }, error: new Error("Invalid token") };
  const { data: profile, error } = await client
    .from("profiles")
    .select("id,auth_email")
    .eq("id", subject)
    .maybeSingle();
  if (error || !profile?.id) return { data: { user: null }, error: error ?? new Error("Unknown user") };
  return {
    data: { user: { id: profile.id, email: profile.auth_email ?? null } },
    error: null,
  };
};
