import { authenticatedSelect } from "./authenticatedDataClient";

export type HttpSessionSummary = {
  authenticated: boolean;
  user: {
    id: string;
    email: string | null;
    last_sign_in_at: string | null;
  } | null;
  profile: {
    role: "tenant_account" | "workspace_admin" | "super_admin" | null;
    workspace_id: string | null;
    auth_email: string | null;
    is_active: boolean | null;
  } | null;
  password_authenticated_at?: string | null;
};

/**
 * A session request that never reached the server: the browser is offline, DNS
 * or TLS failed, an extension or corporate proxy blocked the cross-origin call
 * to the edge proxy, or the proxy is simply unreachable from a dev machine.
 *
 * This is deliberately distinct from `Session request failed (<status>).`, which
 * means the server answered and refused. Callers use the distinction to decide
 * whether retrying is worthwhile and whether the failure is worth an error-level
 * log — an unreachable session service is an environment condition, not a bug.
 */
export class SessionNetworkError extends Error {
  readonly action: string;
  readonly cause?: unknown;

  constructor(action: string, cause?: unknown) {
    super(`Unable to reach the ItemTraxx session service (${action}).`);
    this.name = "SessionNetworkError";
    this.action = action;
    this.cause = cause;
  }
}

export const isSessionNetworkError = (error: unknown): error is SessionNetworkError =>
  error instanceof SessionNetworkError;

const getAuthClient = async () => (await import("../auth/client")).authClient;

export const fetchHttpSessionSummary = async (_options: Pick<RequestInit, "signal"> = {}): Promise<HttpSessionSummary> => {
  const authClient = await getAuthClient();
  const { data, error } = await authClient.getSession();
  if (error || !data?.user || !data.session) {
    return { authenticated: false, user: null, profile: null, password_authenticated_at: null };
  }
  const profiles = await authenticatedSelect<Array<NonNullable<HttpSessionSummary["profile"]> & { id: string }>>(
    "profiles",
    { select: "id,role,workspace_id,auth_email,is_active", better_auth_user_id: `eq.${data.user.id}`, limit: "1" },
    { suppressUnauthorizedRecovery: true },
  ).catch(() => []);
  return {
    authenticated: true,
    user: {
      id: profiles[0]?.id ?? data.user.id,
      email: data.user.email ?? null,
      last_sign_in_at: data.session.createdAt instanceof Date
        ? data.session.createdAt.toISOString()
        : data.session.createdAt ? String(data.session.createdAt) : null,
    },
    profile: profiles[0] ?? null,
    password_authenticated_at: null,
  } satisfies HttpSessionSummary;
};

export const clearHttpSession = async () => {
  const authClient = await getAuthClient();
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "Unable to complete logout");
  return { ok: true };
};
