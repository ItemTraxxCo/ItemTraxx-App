import {
  clearAdminVerification,
  clearAuthState,
  getAuthState,
  setWorkspaceContext,
} from "../../store/authState";
import { revokeCurrentAccountSession } from "../adminOpsService";
import { resolveWorkspaceHost } from "../workspaceService";
import { clearHttpSession } from "../httpSessionService";
import { clearOfflineCheckoutQueue } from "../offlineCheckoutQueue";
import { clearOfflineCheckoutWorkflow } from "../offlineCheckoutWorkflow";
import { clearOfflineConnectionState } from "../offlineConnectionState";
import { signOutLocalSupabaseSession } from "../supabaseAuthSession";
import { clearPendingSuperAdminVerificationEmail } from "./sessionState";
import { shutdownIntercom } from "../intercomService";

export type SignOutOptions = {
  /** Login/error cleanup may continue locally when the server is unreachable. */
  bestEffort?: boolean;
};

export type SignOutResult = {
  ok: boolean;
  httpSessionCleared: boolean;
  accountSessionRevoked: boolean;
};

export const signOut = async ({ bestEffort = false }: SignOutOptions = {}): Promise<SignOutResult> => {
  shutdownIntercom();
  const current = getAuthState();
  const shouldRevokeAccountSession = current.role === "workspace_admin" && !!current.adminVerifiedAt;
  let accountSessionRevoked = !shouldRevokeAccountSession;

  if (shouldRevokeAccountSession) {
    try {
      await revokeCurrentAccountSession();
      accountSessionRevoked = true;
    } catch {
      // The server-side auth session is still revoked below, but expose the
      // device-session failure so callers can offer a retry/alert.
      accountSessionRevoked = false;
    }
  }

  let httpSessionCleared = false;
  try {
    await clearHttpSession();
    httpSessionCleared = true;
  } catch {
    if (!bestEffort) {
      // Keep local auth state intact so a user-initiated logout can be retried;
      // do not redirect or claim success while the HttpOnly session may live.
      return {
        ok: false,
        httpSessionCleared: false,
        accountSessionRevoked,
      };
    }
  }

  try {
    await signOutLocalSupabaseSession();
  } catch {
    // The server-side HttpOnly session was already cleared; continue local
    // cleanup when the SDK has no session or cannot complete its sign-out.
  }
  await clearOfflineCheckoutQueue();
  await clearOfflineCheckoutWorkflow();
  clearOfflineConnectionState();
  clearAdminVerification();
  clearPendingSuperAdminVerificationEmail();
  clearAuthState(true);
  setWorkspaceContext(null);

  return {
    ok: httpSessionCleared,
    httpSessionCleared,
    accountSessionRevoked,
  };
};

export const getPostSignOutUrl = () => {
  if (typeof window === "undefined") {
    return "/login";
  }

  const { host, isWorkspaceHost } = resolveWorkspaceHost(window.location.hostname);
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) {
    return "/login";
  }

  if (
    normalizedHost === "itemtraxx.com" ||
    normalizedHost === "www.itemtraxx.com" ||
    normalizedHost === "localhost" ||
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "0.0.0.0" ||
    normalizedHost.endsWith(".localhost")
  ) {
    return "/login";
  }

  if (isWorkspaceHost || normalizedHost !== "app.itemtraxx.com") {
    return "https://itemtraxx.com/login";
  }

  return "/login";
};
