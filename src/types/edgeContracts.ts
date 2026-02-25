export type EdgeEnvelope<TData> = {
  data?: TData;
};

export type TenantFeatureFlags = {
  enable_notifications: boolean;
  enable_bulk_item_import: boolean;
  enable_bulk_student_tools: boolean;
  enable_status_tracking: boolean;
  enable_barcode_generator: boolean;
};

export type TenantStatus = "active" | "suspended";

export type SuperTenantAction =
  | "list_tenants"
  | "create_tenant"
  | "update_tenant"
  | "set_tenant_status"
  | "send_primary_admin_reset"
  | "set_primary_admin";

export type SuperAdminAction =
  | "list_tenant_admins"
  | "create_tenant_admin"
  | "set_admin_status"
  | "update_admin_email"
  | "send_reset";

export type SuperGearAction = "list" | "create" | "update" | "delete";
export type SuperStudentAction = "list" | "create" | "update" | "delete";

export type AdminOpsAction =
  | "get_notifications"
  | "get_status_tracking"
  | "bulk_import_gear"
  | "get_tenant_settings"
  | "update_tenant_settings"
  | "touch_session"
  | "validate_session"
  | "list_sessions"
  | "revoke_session"
  | "revoke_all_sessions";
