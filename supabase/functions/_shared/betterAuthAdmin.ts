const requiredEnv = (name: string) => {
  const value = (Deno.env.get(name) ?? "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

export type BetterAuthAdminAction =
  | { action: "create_organization"; workspaceId: string; name: string; slug: string }
  | { action: "delete_organization"; organizationId: string }
  | { action: "create_user"; profileId: string; email: string; password: string; name?: string; role: string; profileRole: string; workspaceId?: string | null }
  | { action: "update_email"; profileId: string; email: string }
  | { action: "delete_user" | "revoke_sessions" | "verify_password" | "list_passkeys"; profileId: string; betterAuthUserId?: string; password?: string }
  | { action: "request_password_reset"; profileId: string; redirectTo?: string; betterAuthUserId?: string }
  | { action: "delete_passkey"; profileId: string; passkeyId: string };

export const callBetterAuthAdmin = async <T = Record<string, unknown>>(payload: BetterAuthAdminAction): Promise<T> => {
  const baseUrl = requiredEnv("BETTER_AUTH_URL").replace(/\/+$/, "");
  // Keep this bridge under Better Auth's API namespace. The edge hostname's
  // managed bot protection challenges unknown `/api/*` paths, which blocks
  // server-to-server calls from Supabase Edge Functions before the Worker can
  // validate this shared secret.
  const response = await fetch(`${baseUrl}/api/auth/internal-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-itx-internal-auth": requiredEnv("ITX_INTERNAL_AUTH_SECRET") },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error || "Better Auth administration failed");
  return result;
};
