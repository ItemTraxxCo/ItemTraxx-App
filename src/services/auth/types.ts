export type AuthRole = "tenant_user" | "tenant_admin" | "district_admin" | "super_admin";

export type ProfileRow = {
  id: string;
  role: AuthRole | null;
  tenant_id: string | null;
  district_id?: string | null;
  auth_email: string | null;
  is_active?: boolean | null;
};

export type TenantRow = {
  id: string;
  status: "active" | "suspended" | "archived" | null;
  district_id?: string | null;
};

export type LoginNotificationLocation =
  | "tenant_login"
  | "tenant_admin_login"
  | "district_admin_login"
  | "super_admin_login"
  | "regular_login"
  | "admin_login";

export type TenantAdminSessionLocation = "regular_login" | "admin_login";

export const normalizeFunctionTarget = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || fallback;
  } catch {
    const segments = trimmed.split("/").filter(Boolean);
    return segments[segments.length - 1] || fallback;
  }
};

export const normalizeLoginNotificationLocation = (
  value: string | null
): LoginNotificationLocation | null => {
  if (
    value === "tenant_login" ||
    value === "tenant_admin_login" ||
    value === "district_admin_login" ||
    value === "super_admin_login" ||
    value === "regular_login" ||
    value === "admin_login"
  ) {
    return value;
  }
  return null;
};

export const toTenantAdminSessionLocation = (
  value: LoginNotificationLocation | null | undefined
): TenantAdminSessionLocation | null => {
  if (!value) return null;
  if (value === "regular_login" || value === "tenant_login") return "regular_login";
  if (
    value === "admin_login" ||
    value === "tenant_admin_login" ||
    value === "district_admin_login"
  ) {
    return "admin_login";
  }
  return null;
};

export const toKnownRole = (value: unknown): ProfileRow["role"] => {
  if (
    value === "tenant_user" ||
    value === "tenant_admin" ||
    value === "district_admin" ||
    value === "super_admin"
  ) {
    return value;
  }
  return null;
};
