# Edge Endpoint Reference

Human-readable summary generated from the current OpenAPI and JSON Schema artifacts.

Generated from:
- `/docs/api/generated/edge-contracts.openapi.json`
- `/docs/api/generated/edge-contracts.schema.json`

## `POST /functions/v1/admin-ops`

Workspace admin operations

Workspace admin operational actions used by the admin panel.

### Supported actions

#### `get_notifications`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string

#### `get_status_tracking`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string

#### `get_workspace_dashboard`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string

#### `bulk_import_items`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string
- `rows` (required): array

#### `get_workspace_settings`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string

#### `update_workspace_settings`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string
- `checkout_due_hours` (required): integer

#### `touch_session`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string

#### `validate_session`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string

#### `list_sessions`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string

#### `revoke_current_session`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string

#### `revoke_session`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string
- `session_id` (required): string

#### `revoke_all_sessions`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string
- `sign_out_current` (required): boolean

### Response schema

- Schema: `adminOpsResponses`
- Top-level keys: `get_notifications`, `get_status_tracking`, `get_workspace_dashboard`, `bulk_import_items`, `get_workspace_settings`, `update_workspace_settings`, `touch_session`, `validate_session`, `list_sessions`, `revoke_current_session`, `revoke_session`, `revoke_all_sessions`

## `POST /functions/v1/super-workspace-mutate`

Super admin workspace mutations

Super-admin workspace creation and lifecycle actions.

### Supported actions

#### `list_workspaces`

- `search` (required): string
- `status` (required): string

#### `create_workspace`

- `name` (required): string
- `slug` (required): string
- `auth_email` (required): string
- `password`: string
- `account_category`: string
- `plan_code`: string

#### `update_workspace`

- `id` (required): string
- `name` (required): string
- `slug` (required): string
- `account_category`: string
- `plan_code`: string

#### `set_workspace_status`

- `id` (required): string
- `status` (required): string

#### `send_primary_admin_reset`

- `workspace_id` (required): string

#### `set_primary_admin`

- `workspace_id` (required): string
- `profile_id` (required): string

### Response schema

- Schema: `superWorkspaceResponses`
- Top-level keys: `list_workspaces`, `create_workspace`, `update_workspace`, `set_workspace_status`, `send_primary_admin_reset`, `set_primary_admin`

## `POST /functions/v1/super-admin-mutate`

Super admin account mutations

Super-admin account management for Workspace Admins and Super Admins.

### Supported actions

#### `list_workspace_admins`

- `search` (required): string
- `workspace_id` (required): string

#### `create_workspace_admin`

- `workspace_id`: string
- `auth_email` (required): string

#### `set_workspace_admin_status`

- `id` (required): string
- `is_active` (required): boolean

#### `update_workspace_admin_email`

- `id` (required): string
- `auth_email` (required): string

#### `send_workspace_admin_reset`

- `id` (required): string

#### `list_super_admins`

- `search` (required): string

#### `create_super_admin`

- `auth_email` (required): string
- `password` (required): string

#### `set_super_admin_status`

- `id` (required): string
- `is_active` (required): boolean

#### `update_super_admin_email`

- `id` (required): string
- `auth_email` (required): string

#### `send_super_admin_reset`

- `auth_email` (required): string

### Response schema

- Schema: `superAdminResponses`
- Top-level keys: `list_workspace_admins`, `create_workspace_admin`, `set_workspace_admin_status`, `update_workspace_admin_email`, `send_workspace_admin_reset`, `list_super_admins`, `create_super_admin`, `set_super_admin_status`, `update_super_admin_email`, `send_super_admin_reset`

## `POST /functions/v1/super-ops`

Super admin operations and reporting

Super-admin operational controls, approvals, customer ops, and reporting.

### Supported actions

#### `verify_password`

- `password` (required): string

#### `touch_session`

- `device_id` (required): string
- `device_label`: any
- `login_method`: any
- `login_location`: any

#### `list_sessions`

- `device_id`: string
- `device_label`: any
- `login_method`: any
- `login_location`: any

#### `list_passkeys`

- No additional fields.

#### `start_passkey_registration`

- No additional fields.

#### `verify_passkey_registration`

- `challenge_id` (required): string
- `credential` (required): object

#### `delete_passkey`

- `passkey_id` (required): string

#### `revoke_session`

- `device_id`: string
- `device_label`: any
- `login_method`: any
- `login_location`: any
- `session_id` (required): string

#### `revoke_all_sessions`

- `device_id`: string
- `device_label`: any
- `login_method`: any
- `login_location`: any
- `sign_out_current`: boolean

#### `get_control_center`

- No additional fields.

#### `set_runtime_config`

- `key` (required): string
- `value` (required): any

#### `upsert_alert_rule`

- `id`: string
- `name` (required): string
- `metric_key` (required): string
- `threshold` (required): number
- `is_enabled`: boolean

#### `set_workspace_policy`

- `workspace_id` (required): string
- `max_admins`: any
- `max_borrowers`: any
- `max_items`: any
- `checkout_due_hours`: any
- `barcode_pattern`: any
- `feature_flags`: object

#### `set_workspace_force_reauth`

- `workspace_id` (required): string

#### `create_approval`

- `action_type` (required): string
- `payload` (required): any

#### `approve_request`

- `id` (required): string

#### `list_support_requests`

- `search`: string
- `status`: any
- `limit`: integer

#### `get_support_request`

- `support_request_id` (required): string

#### `update_support_request`

- `support_request_id` (required): string
- `status`: string
- `internal_notes`: string
- `assign_to_me`: boolean
- `clear_assignment`: boolean

#### `list_sales_leads`

- `search`: string
- `limit`: integer

#### `close_sales_lead`

- `lead_id` (required): string

#### `move_sales_lead_to_customer`

- `lead_id` (required): string

#### `set_sales_lead_stage`

- `lead_id` (required): string
- `stage` (required): string

#### `delete_sales_lead`

- `lead_id` (required): string

#### `list_customers`

- `search`: string
- `limit`: integer

#### `add_customer_status_entry`

- `lead_id` (required): string
- `invoice_id` (required): string
- `status` (required): string

#### `get_internal_ops_snapshot`

- No additional fields.

#### `preview_subprocessor_notice`

- `vendor` (required): string
- `change_type` (required): string
- `effective_date` (required): string
- `description`: string

#### `announce_subprocessor_change`

- `vendor` (required): string
- `change_type` (required): string
- `effective_date` (required): string
- `description`: string

#### `list_subprocessor_notices`

- No additional fields.

### Response schema

- Schema: `superOpsResponses`
- Top-level keys: `verify_password`, `touch_session`, `list_sessions`, `list_passkeys`, `start_passkey_registration`, `verify_passkey_registration`, `delete_passkey`, `revoke_session`, `revoke_all_sessions`, `get_control_center`, `set_runtime_config`, `upsert_alert_rule`, `set_workspace_policy`, `set_workspace_force_reauth`, `create_approval`, `approve_request`, `list_support_requests`, `get_support_request`, `update_support_request`, `list_sales_leads`, `close_sales_lead`, `move_sales_lead_to_customer`, `set_sales_lead_stage`, `delete_sales_lead`, `list_customers`, `add_customer_status_entry`, `get_internal_ops_snapshot`, `preview_subprocessor_notice`, `announce_subprocessor_change`, `list_subprocessor_notices`

## `POST /functions/v1/workspace-admin-mutate`

Primary Workspace Admin peer management

Primary Workspace Admin-only peer management for the current workspace.

### Supported actions

#### `list_workspace_admins`

- No additional fields.

#### `create_workspace_admin`

- `auth_email` (required): string

#### `set_admin_status`

- `id` (required): string
- `is_active` (required): boolean

#### `update_admin_email`

- `id` (required): string
- `auth_email` (required): string

#### `send_workspace_admin_reset`

- `auth_email` (required): string

#### `list_tenant_accounts`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string

#### `create_tenant_account`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string
- `auth_email` (required): string

#### `set_tenant_account_status`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string
- `id` (required): string
- `is_active` (required): boolean

#### `update_tenant_account_email`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string
- `id` (required): string
- `auth_email` (required): string

#### `remove_tenant_account`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string
- `id` (required): string

#### `send_tenant_account_reset`

- `device_id` (required): string
- `device_label` (required): string
- `login_method`: string
- `login_location`: string
- `id` (required): string

### Response schema

- Schema: `workspaceAdminManageResponses`
- Top-level keys: `list_workspace_admins`, `create_workspace_admin`, `set_admin_status`, `update_admin_email`, `send_workspace_admin_reset`, `list_tenant_accounts`, `create_tenant_account`, `set_tenant_account_status`, `update_tenant_account_email`, `remove_tenant_account`, `send_tenant_account_reset`

## `POST /functions/v1/contact-sales-submit`

Public contact sales/demo form submit

Public contact-sales and request-demo form submit endpoint.

### Request

- No action-based request body.

### Response schema

- Schema: `contactSalesSubmitResponse`
- Top-level keys: `ok`, `data`, `error`

## `POST /functions/v1/contact-support-submit`

Public contact support form submit

Public support form submit endpoint.

### Request

- No action-based request body.

### Response schema

- Schema: `contactSupportSubmitResponse`
- Top-level keys: `ok`, `data`, `error`
