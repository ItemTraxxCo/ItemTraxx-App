# Edge Endpoint Reference

Human-readable summary generated from the current OpenAPI and JSON Schema artifacts.

Generated from:
- `/docs/api/generated/edge-contracts.openapi.json`
- `/docs/api/generated/edge-contracts.schema.json`

Generated at: 2026-03-11T05:39:39.897Z

## `POST /functions/v1/admin-ops`

Tenant admin operations

Tenant admin operational actions used by the tenant admin panel.

### Supported actions

#### `get_notifications`

- `device_id` (required): string
- `device_label` (required): string

#### `get_status_tracking`

- `device_id` (required): string
- `device_label` (required): string

#### `bulk_import_gear`

- `device_id` (required): string
- `device_label` (required): string
- `rows` (required): array

#### `get_tenant_settings`

- `device_id` (required): string
- `device_label` (required): string

#### `update_tenant_settings`

- `device_id` (required): string
- `device_label` (required): string
- `checkout_due_hours` (required): integer

#### `touch_session`

- `device_id` (required): string
- `device_label` (required): string

#### `validate_session`

- `device_id` (required): string
- `device_label` (required): string

#### `list_sessions`

- `device_id` (required): string
- `device_label` (required): string

#### `revoke_session`

- `device_id` (required): string
- `device_label` (required): string
- `session_id` (required): string

#### `revoke_all_sessions`

- `device_id` (required): string
- `device_label` (required): string
- `sign_out_current` (required): boolean

### Response schema

- Schema: `adminOpsResponses`
- Top-level keys: `get_notifications`, `get_status_tracking`, `bulk_import_gear`, `get_tenant_settings`, `update_tenant_settings`, `touch_session`, `validate_session`, `list_sessions`, `revoke_session`, `revoke_all_sessions`

## `POST /functions/v1/super-tenant-mutate`

Super admin tenant and district mutations

Super-admin tenant and district creation/update actions.

### Supported actions

#### `list_tenants`

- `search` (required): string
- `status` (required): string

#### `create_tenant`

- `name` (required): string
- `access_code` (required): string
- `auth_email` (required): string
- `password` (required): string
- `status` (required): string
- `account_category`: string
- `plan_code`: string
- `district_name`: string
- `district_slug`: string

#### `update_tenant`

- `id` (required): string
- `name` (required): string
- `access_code` (required): string
- `account_category`: string
- `plan_code`: string
- `district_name`: string
- `district_slug`: string

#### `set_tenant_status`

- `id` (required): string
- `status` (required): string
- `super_password` (required): string
- `confirm_phrase` (required): string

#### `send_primary_admin_reset`

- `tenant_id` (required): string

#### `set_primary_admin`

- `tenant_id` (required): string
- `profile_id` (required): string

#### `list_districts`

- `search` (required): string

#### `create_district`

- `name` (required): string
- `slug` (required): string
- `support_email`: string
- `contact_name`: string
- `subscription_plan`: string
- `billing_status`: string
- `renewal_date`: string
- `billing_email`: string
- `invoice_reference`: string

#### `update_district`

- `id` (required): string
- `name` (required): string
- `slug` (required): string
- `support_email`: string
- `contact_name`: string
- `is_active` (required): boolean
- `subscription_plan`: string
- `billing_status`: string
- `renewal_date`: string
- `billing_email`: string
- `invoice_reference`: string

#### `get_district_details`

- `id` (required): string

### Response schema

- Schema: `superTenantResponses`
- Top-level keys: `list_tenants`, `create_tenant`, `update_tenant`, `set_tenant_status`, `send_primary_admin_reset`, `set_primary_admin`, `list_districts`, `create_district`, `update_district`, `get_district_details`

## `POST /functions/v1/super-admin-mutate`

Super admin account mutations

Super-admin account management for tenant and district admins.

### Supported actions

#### `list_tenant_admins`

- `search` (required): string
- `tenant_id` (required): string
- `district_id` (required): string
- `admin_scope` (required): string

#### `create_tenant_admin`

- `tenant_id`: string
- `district_id`: string
- `auth_email` (required): string
- `password` (required): string
- `admin_scope`: string

#### `set_admin_status`

- `id` (required): string
- `is_active` (required): boolean
- `admin_scope`: string

#### `update_admin_email`

- `id` (required): string
- `auth_email` (required): string
- `admin_scope`: string

#### `send_reset`

- `auth_email` (required): string
- `admin_scope`: string

### Response schema

- Schema: `superAdminResponses`
- Top-level keys: `list_tenant_admins`, `create_tenant_admin`, `set_admin_status`, `update_admin_email`, `send_reset`

## `POST /functions/v1/super-ops`

Super admin operations and reporting

Super-admin operational controls, approvals, customer ops, and reporting.

### Supported actions

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

#### `set_tenant_policy`

- `tenant_id` (required): string
- `max_admins`: any
- `max_students`: any
- `max_gear`: any
- `checkout_due_hours`: any
- `barcode_pattern`: any
- `feature_flags`: object

#### `set_tenant_force_reauth`

- `tenant_id` (required): string

#### `create_approval`

- `action_type` (required): string
- `payload` (required): any

#### `approve_request`

- `id` (required): string

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

### Response schema

- Schema: `superOpsResponses`
- Top-level keys: `get_control_center`, `set_runtime_config`, `upsert_alert_rule`, `set_tenant_policy`, `set_tenant_force_reauth`, `create_approval`, `approve_request`, `list_sales_leads`, `close_sales_lead`, `move_sales_lead_to_customer`, `set_sales_lead_stage`, `delete_sales_lead`, `list_customers`, `add_customer_status_entry`, `get_internal_ops_snapshot`

## `POST /functions/v1/tenant-admin-mutate`

Primary-admin tenant admin management

Primary-admin-only tenant admin management for the current tenant.

### Supported actions

#### `list_tenant_admins`

- No additional fields.

#### `create_tenant_admin`

- `auth_email` (required): string

#### `set_admin_status`

- `id` (required): string
- `is_active` (required): boolean

#### `update_admin_email`

- `id` (required): string
- `auth_email` (required): string

#### `send_tenant_admin_reset`

- `auth_email` (required): string

### Response schema

- Schema: `tenantAdminManageResponses`
- Top-level keys: `list_tenant_admins`, `create_tenant_admin`, `set_admin_status`, `update_admin_email`, `send_tenant_admin_reset`

## `GET /functions/v1/district-dashboard`

District dashboard snapshot

District dashboard snapshot and analytics feed.

### Request

- No action-based request body.

### Response schema

- Schema: `districtDashboardResponse`
- Top-level keys: `data`

## `POST /functions/v1/district-handoff`

Cross-host district session handoff

Cross-host login handoff for district-routed auth flows.

### Supported actions

#### `create`

- `auth_email` (required): string
- `password` (required): string
- `district_slug` (required): string

#### `create_admin`

- `email` (required): string
- `password` (required): string

#### `consume`

- `code` (required): string

### Response schema

- Schema: `districtHandoffResponses`
- Top-level keys: `create`, `create_admin`, `consume`

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
