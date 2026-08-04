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

export const signOut = async () => {
  shutdownIntercom();
  const current = getAuthState();
  const shouldRevokeAccountSession = current.role === "workspace_admin" && !!current.adminVerifiedAt;

  if (shouldRevokeAccountSession) {
    try {
      await revokeCurrentAccountSession();
    } catch {
      // Ignore device-session revocation failures during sign-out.
    }
  }

  await signOutLocalSupabaseSession();
  await clearOfflineCheckoutQueue();
  await clearOfflineCheckoutWorkflow();
  clearOfflineConnectionState();
  try {
    await clearHttpSession();
  } catch {
    // Ignore cookie logout failures during the migration window.
  }
  clearAdminVerification();
  clearPendingSuperAdminVerificationEmail();
  clearAuthState(true);
  setWorkspaceContext(null);
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
