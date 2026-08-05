export type EdgeEnvelope<TData> = {
  data?: TData;
};

export type TenantFeatureFlags = {
  enable_notifications: boolean;
  enable_bulk_item_import: boolean;
  enable_bulk_borrower_tools: boolean;
  enable_status_tracking: boolean;
  enable_barcode_generator: boolean;
};

export type SuperItemAction = "list" | "create" | "update" | "delete";
export type SuperBorrowerAction = "list" | "create" | "update" | "delete";

export type AdminOpsAction =
  | "get_notifications"
  | "get_status_tracking"
  | "get_workspace_dashboard"
  | "bulk_import_items"
  | "get_workspace_settings"
  | "update_workspace_settings"
  | "touch_session"
  | "validate_session"
  | "list_sessions"
  | "revoke_current_session"
  | "revoke_session"
  | "revoke_all_sessions";

export type WorkspaceAdminManageAction =
  | "list_workspace_admins"
  | "create_workspace_admin"
  | "set_admin_status"
  | "update_admin_email"
  | "send_workspace_admin_reset"
  | "list_tenant_accounts"
  | "create_tenant_account"
  | "set_tenant_account_status"
  | "update_tenant_account_email"
  | "remove_tenant_account"
  | "send_tenant_account_reset";
