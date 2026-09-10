import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements as organizationStatements,
} from "better-auth/plugins/organization/access";
import {
  defaultStatements as adminStatements,
} from "better-auth/plugins/admin/access";
import {
  organizationStatements as itemTraxxOrganizationStatements,
  regularUserRoleStatements,
  superAdminRoleStatements,
  tenantAccountRoleStatements,
  workspaceAdminRoleStatements,
} from "../../../../src/auth/permissionDefinitions.ts";

export const organizationAccess = createAccessControl({
  ...organizationStatements,
  ...itemTraxxOrganizationStatements,
} as const);

export const tenantAccountRole = organizationAccess.newRole(tenantAccountRoleStatements);
export const workspaceAdminRole = organizationAccess.newRole(workspaceAdminRoleStatements);

export const globalAccess = createAccessControl(adminStatements);
export const regularUserRole = globalAccess.newRole(regularUserRoleStatements);
export const superAdminRole = globalAccess.newRole(superAdminRoleStatements);

export const organizationRoles = {
  member: tenantAccountRole,
  admin: workspaceAdminRole,
  tenant_account: tenantAccountRole,
  workspace_admin: workspaceAdminRole,
} as const;

export const globalRoles = {
  user: regularUserRole,
  super_admin: superAdminRole,
} as const;
