import { withTimeout } from "../asyncUtils";
import {
  clearAdminVerification,
  clearAuthState,
  getAuthState,
  getPersistedAdminVerification,
  setAuthStateFromBackend,
} from "../../store/authState";
import { clearSessionTermination } from "../../store/sessionTermination";
import { lookupDistrictById } from "../districtService";
import { fetchHttpSessionSummary } from "../httpSessionService";
import { signOutLocalSupabaseSession } from "../supabaseAuthSession";
import { authenticatedRpc, authenticatedSelect } from "../authenticatedDataClient";
import { toKnownRole, type ProfileRow, type TenantRow } from "./types";

const AUTH_QUERY_TIMEOUT_MS = 15000;

const withRetry = async <T>(
  fn: () => Promise<T>,
  attempts = 2,
  delayMs = 250
): Promise<T> => {
  let lastError: unknown = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (index + 1 >= attempts) {
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
};

export const fetchCurrentRoleAndTenant = async () => {
  const [roleResult, tenantResult] = await Promise.all([
    withRetry(
      () =>
        withTimeout(
          authenticatedRpc<string | null>("current_user_role", {}, {
            suppressUnauthorizedRecovery: true,
          }),
          AUTH_QUERY_TIMEOUT_MS,
          "Role lookup timed out."
        ),
      2
    ),
    withRetry(
      () =>
        withTimeout(
          authenticatedRpc<string | null>("current_tenant_id", {}, {
            suppressUnauthorizedRecovery: true,
          }),
          AUTH_QUERY_TIMEOUT_MS,
          "Tenant lookup timed out."
        ),
      2
    ),
  ]);

  return {
    role: toKnownRole(roleResult),
    tenantId: typeof tenantResult === "string" && tenantResult.trim() ? tenantResult : null,
  };
};

export const fetchProfile = async (userId: string): Promise<ProfileRow | null> => {
  let data: unknown = null;
  try {
    const response = await withRetry(
      () =>
        withTimeout(
          authenticatedSelect<ProfileRow[]>("profiles", {
            select: "id,role,tenant_id,district_id,auth_email,is_active",
            id: `eq.${userId}`,
            limit: "1",
          }, {
            suppressUnauthorizedRecovery: true,
          }),
          AUTH_QUERY_TIMEOUT_MS,
          "Profile lookup timed out."
        ),
      2
    );
    data = response?.[0] ?? null;
  } catch {
    console.error("Profile lookup failed.");
    try {
      const { role, tenantId } = await fetchCurrentRoleAndTenant();
      if (!role && !tenantId) {
        return null;
      }
      return {
        id: userId,
        role,
        tenant_id: tenantId,
        district_id: null,
        auth_email: null,
        is_active: null,
      };
    } catch {
      console.error("Profile fallback lookup failed.");
      return null;
    }
  }

  return data as ProfileRow;
};

export const fetchTenantContext = async (tenantId: string): Promise<TenantRow | null> => {
  let data: unknown = null;
  try {
    const response = await withRetry(
      () =>
        withTimeout(
          authenticatedSelect<TenantRow[]>("tenants", {
            select: "id,status,district_id",
            id: `eq.${tenantId}`,
            limit: "1",
          }, {
            suppressUnauthorizedRecovery: true,
          }),
          AUTH_QUERY_TIMEOUT_MS,
          "Tenant status lookup timed out."
        ),
      2
    );
    data = response?.[0] ?? null;
  } catch {
    console.error("Tenant status lookup failed.");
    return null;
  }

  return data as TenantRow;
};

const resolveEffectiveDistrictId = async (profile: ProfileRow | null) => {
  if (profile?.district_id) {
    return profile.district_id;
  }
  if (!profile?.tenant_id) {
    return null;
  }
  const tenant = await fetchTenantContext(profile.tenant_id);
  return tenant?.district_id ?? null;
};

export const resolveDistrictSlug = async (districtId: string | null) => {
  if (!districtId) {
    return null;
  }
  const district = await lookupDistrictById(districtId);
  return district?.slug?.trim() || null;
};

const handleSuspendedTenantSession = async (profile: ProfileRow | null) => {
  if (!profile?.tenant_id || !["tenant_user", "tenant_admin"].includes(profile.role ?? "")) {
    return false;
  }
  const tenant = await fetchTenantContext(profile.tenant_id);
  if (tenant?.status && tenant.status !== "active") {
    await signOutLocalSupabaseSession();
    clearAdminVerification();
    clearAuthState(true);
    return true;
  }
  return false;
};

export const applyHttpSessionSummary = async (
  summary: Awaited<ReturnType<typeof fetchHttpSessionSummary>>
) => {
  if (!summary.authenticated || !summary.user) {
    clearAuthState(true);
    return;
  }

  const profile: ProfileRow | null = summary.profile
    ? {
        id: summary.user.id,
        role: summary.profile.role,
        tenant_id: summary.profile.tenant_id,
        district_id: summary.profile.district_id,
        auth_email: summary.profile.auth_email,
        is_active: summary.profile.is_active,
      }
    : null;

  const effectiveDistrictId = await resolveEffectiveDistrictId(profile);
  const isSuspended = await handleSuspendedTenantSession(profile);
  if (isSuspended) {
    return;
  }

  const current = getAuthState();
  const isSameUser = current.userId === summary.user.id;
  const resolvedRole = profile?.role ?? (isSameUser ? current.role : null);
  const resolvedSessionTenantId =
    profile?.tenant_id ?? (isSameUser ? current.sessionTenantId : null);
  const isSuperRole = resolvedRole === "super_admin";

  const persistedAdminVerifiedAt =
    resolvedRole === "tenant_admin" || resolvedRole === "district_admin"
      ? getPersistedAdminVerification(summary.user.id)
      : null;

  setAuthStateFromBackend({
    isInitialized: true,
    isAuthenticated: true,
    userId: summary.user.id,
    email: summary.user.email ?? null,
    signedInAt: summary.user.last_sign_in_at ?? null,
    role: resolvedRole,
    sessionTenantId: resolvedSessionTenantId,
    tenantContextId: current.tenantContextId ?? resolvedSessionTenantId ?? null,
    districtContextId:
      effectiveDistrictId ?? (isSameUser ? current.districtContextId : null) ?? null,
    hasSecondaryAuth:
      isSameUser && isSuperRole ? current.hasSecondaryAuth ?? false : false,
    superVerifiedAt:
      isSameUser && isSuperRole ? current.superVerifiedAt ?? null : null,
    adminVerifiedAt:
      (isSameUser ? current.adminVerifiedAt : null) ?? persistedAdminVerifiedAt ?? null,
  });
  clearSessionTermination();
};

export const refreshAuthFromSession = async () => {
  try {
    const summary = await withTimeout(
      fetchHttpSessionSummary(),
      AUTH_QUERY_TIMEOUT_MS,
      "Session refresh timed out."
    );
    await applyHttpSessionSummary(summary);
  } catch {
    console.error("Session refresh failed.");
    clearAuthState(true);
  }
};

export const initAuthListener = () => {
  // Cookie-backed sessions are restored through /auth/session/me during bootstrap.
  // Keep the listener disabled so transient in-memory Supabase auth state does not
  // overwrite the server-managed session view.
};
