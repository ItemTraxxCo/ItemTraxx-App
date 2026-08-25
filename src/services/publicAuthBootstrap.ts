import { clearAuthState, getAuthState, type AuthState } from "../store/authState";
import type { HttpSessionSummary } from "./httpSessionService";
import { fetchHttpSessionSummary, isSessionNetworkError } from "./httpSessionService";

const LEGACY_AUTH_FRAGMENT_KEYS = ["itx_hc", "itx_th", "itx_at", "itx_rt"];

const SESSION_PROBE_RETRY_DELAY_MS = 500;

type AuthBootstrapSnapshot = Pick<
  AuthState,
  | "isAuthenticated"
  | "userId"
  | "role"
  | "sessionWorkspaceId"
  | "workspaceContextId"
  | "hasSecondaryAuth"
  | "superVerifiedAt"
  | "adminVerifiedAt"
>;

const readAuthBootstrapSnapshot = (): AuthBootstrapSnapshot => {
  const auth = getAuthState();
  return {
    isAuthenticated: auth.isAuthenticated,
    userId: auth.userId,
    role: auth.role,
    sessionWorkspaceId: auth.sessionWorkspaceId,
    workspaceContextId: auth.workspaceContextId,
    hasSecondaryAuth: auth.hasSecondaryAuth,
    superVerifiedAt: auth.superVerifiedAt,
    adminVerifiedAt: auth.adminVerifiedAt,
  };
};

const isAuthBootstrapSnapshotCurrent = (
  snapshot: AuthBootstrapSnapshot,
  signal?: AbortSignal,
) => {
  if (signal?.aborted) return false;
  const auth = getAuthState();
  return (
    auth.isAuthenticated === snapshot.isAuthenticated &&
    auth.userId === snapshot.userId &&
    auth.role === snapshot.role &&
    auth.sessionWorkspaceId === snapshot.sessionWorkspaceId &&
    auth.workspaceContextId === snapshot.workspaceContextId &&
    auth.hasSecondaryAuth === snapshot.hasSecondaryAuth &&
    auth.superVerifiedAt === snapshot.superVerifiedAt &&
    auth.adminVerifiedAt === snapshot.adminVerifiedAt
  );
};

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The session probe was aborted.", "AbortError"));
      return;
    }

    let timerId: number | null = null;
    const onAbort = () => {
      if (timerId !== null) window.clearTimeout(timerId);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("The session probe was aborted.", "AbortError"));
    };
    timerId = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export const hasLegacyAuthFragment = (hash = window.location.hash): boolean => {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return LEGACY_AUTH_FRAGMENT_KEYS.some((key) => params.has(key));
};

export const scrubLegacyAuthFragment = () => {
  if (typeof window === "undefined" || !hasLegacyAuthFragment()) return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  for (const key of LEGACY_AUTH_FRAGMENT_KEYS) params.delete(key);
  const hash = params.toString();
  window.history.replaceState(
    {},
    document.title,
    `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ""}`,
  );
};

// This probe answers "does this visitor already have a session?" while a public
// page such as /admin/login is booting. It runs once, fire-and-forget, so a
// single transport blip would otherwise leave an already signed-in admin looking
// anonymous for the rest of the page's life — and re-entering credentials they
// did not need. One cheap retry covers that; the caller aborts the probe when
// its bootstrap timeout settles, and the auth snapshot guard prevents late work
// from overwriting a newer login. Only transport failures are retried: a server
// that answered has given a real answer.
const probeHttpSessionSummary = async (signal?: AbortSignal): Promise<HttpSessionSummary> => {
  const fetchSummary = () => fetchHttpSessionSummary(signal ? { signal } : undefined);
  try {
    return await fetchSummary();
  } catch (error) {
    if (!isSessionNetworkError(error) || signal?.aborted) throw error;
    await delay(SESSION_PROBE_RETRY_DELAY_MS, signal);
    return await fetchSummary();
  }
};

export const refreshPublicAuthFromSession = async (signal?: AbortSignal): Promise<void> => {
  const snapshot = readAuthBootstrapSnapshot();
  const isCurrent = () => isAuthBootstrapSnapshotCurrent(snapshot, signal);
  const summary = await probeHttpSessionSummary(signal);
  if (!isCurrent()) return;
  if (!summary.authenticated || !summary.user) {
    clearAuthState(true);
    return;
  }
  const { applyHttpSessionSummary, initAuthListener } = await import("./authService");
  if (!isCurrent()) return;
  await applyHttpSessionSummary(summary, { isCurrent });
  if (!isCurrent()) return;
  initAuthListener();
};
