import { authenticatedSelect } from "./authenticatedDataClient";

export type HttpSessionSummary = {
  authenticated: boolean;
  user: {
    id: string;
    email: string | null;
    last_sign_in_at: string | null;
  } | null;
  profile: {
    role: "tenant_account" | "individual_account" | "workspace_admin" | "super_admin" | null;
    workspace_id: string | null;
    auth_email: string | null;
    is_active: boolean | null;
  } | null;
  password_authenticated_at?: string | null;
};

/** The session endpoint did not provide a trustworthy session result. */
export class SessionNetworkError extends Error {
  readonly action: string;
  readonly cause?: unknown;

  constructor(action: string, cause?: unknown) {
    super(`Unable to read the ItemTraxx session (${action}).`);
    this.name = "SessionNetworkError";
    this.action = action;
    this.cause = cause;
  }
}

export const isSessionNetworkError = (error: unknown): error is SessionNetworkError =>
  error instanceof SessionNetworkError;

const unauthenticatedSummary = (): HttpSessionSummary => ({
  authenticated: false,
  user: null,
  profile: null,
  password_authenticated_at: null,
});

const getAuthClient = async () => (await import("../auth/client")).authClient;

export const fetchHttpSessionSummary = async (options: Pick<RequestInit, "signal"> = {}): Promise<HttpSessionSummary> => {
  const authClient = await getAuthClient();
  let response: Awaited<ReturnType<typeof authClient.getSession>>;
  try {
    response = options.signal
      ? await authClient.getSession({ fetchOptions: { signal: options.signal } })
      : await authClient.getSession();
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new SessionNetworkError("get-session", cause);
  }

  const { data, error } = response;
  if (error) {
    // Better Auth returns an error-free null session when no valid cookie is
    // present. Any error response is an unavailable session result, not proof
    // that a still-valid browser session has expired.
    throw new SessionNetworkError("get-session", error);
  }
  if (!data?.user || !data.session) {
    return unauthenticatedSummary();
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
