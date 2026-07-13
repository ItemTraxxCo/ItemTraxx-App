import type { SuperTenantContext } from "../context.ts";
import { handleDistrictAction } from "./districts.ts";
import { handlePrimaryAdminAction } from "./primaryAdmins.ts";
import { handleListTenants } from "./tenantQueries.ts";
import { handleTenantWriteAction } from "./tenantWrites.ts";

export const SUPER_TENANT_ACTIONS = [
  "list_tenants",
  "list_districts",
  "create_district",
  "update_district",
  "get_district_details",
  "create_tenant",
  "update_tenant",
  "set_tenant_status",
  "send_primary_admin_reset",
  "set_primary_admin",
] as const;

type SuperTenantAction = (typeof SUPER_TENANT_ACTIONS)[number];
type ActionHandler = (context: SuperTenantContext) => Promise<Response>;

const ACTION_HANDLERS: Record<SuperTenantAction, ActionHandler> = {
  list_tenants: handleListTenants,
  list_districts: handleDistrictAction,
  create_district: handleDistrictAction,
  update_district: handleDistrictAction,
  get_district_details: handleDistrictAction,
  create_tenant: handlePrimaryAdminAction,
  update_tenant: handleTenantWriteAction,
  set_tenant_status: handleTenantWriteAction,
  send_primary_admin_reset: handlePrimaryAdminAction,
  set_primary_admin: handlePrimaryAdminAction,
};

export const dispatchSuperTenantAction = (context: SuperTenantContext) => {
  const handler = ACTION_HANDLERS[context.action as SuperTenantAction];
  return handler
    ? handler(context)
    : Promise.resolve(context.jsonResponse(400, { error: "Invalid action" }));
};
