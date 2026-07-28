export type AuthRole = "tenant_account" | "workspace_admin" | "super_admin";
export type ProfileRow = { id: string; role: AuthRole | null; workspace_id: string | null; auth_email: string | null; is_active?: boolean | null; deleted_at?: string | null };
export type WorkspaceRow = { id: string; status: "active" | "suspended" | "archived" | null; slug?: string | null };
export type LoginNotificationLocation = "account_login" | "workspace_admin_login" | "super_admin_login" | "regular_login" | "admin_login";
export type AccountSessionLocation = "regular_login" | "admin_login";
export const normalizeFunctionTarget = (value: string | undefined, fallback: string) => {
  const trimmed=value?.trim(); if(!trimmed) return fallback;
  try { const parts=new URL(trimmed).pathname.split("/").filter(Boolean); return parts.at(-1)||fallback; }
  catch { const parts=trimmed.split("/").filter(Boolean); return parts.at(-1)||fallback; }
};
export const toAccountSessionLocation = (value: LoginNotificationLocation|null|undefined): AccountSessionLocation|null => {
  if (!value) return null; return value === "admin_login" || value === "workspace_admin_login" ? "admin_login" : value === "super_admin_login" ? null : "regular_login";
};
export const toKnownRole = (value: unknown): AuthRole|null => ["tenant_account","workspace_admin","super_admin"].includes(String(value)) ? value as AuthRole : null;
