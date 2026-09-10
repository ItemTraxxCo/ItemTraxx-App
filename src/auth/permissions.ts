import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements as organizationStatements,
} from "better-auth/plugins/organization/access";
import {
  defaultStatements as adminStatements,
} from "better-auth/plugins/admin/access";

export const organizationAccess = createAccessControl({
  ...organizationStatements,
  itemtraxxWorkspace: ["read", "operate", "administer"],
  enterpriseSso: ["read", "create", "update", "delete", "verify-domain"],
} as const);

export const tenantAccountRole = organizationAccess.newRole({
  itemtraxxWorkspace: ["read", "operate"],
  enterpriseSso: [],
  organization: [],
  member: [],
  invitation: [],
});

export const workspaceAdminRole = organizationAccess.newRole({
  itemtraxxWorkspace: ["read", "operate", "administer"],
  enterpriseSso: ["read", "create", "update", "delete", "verify-domain"],
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
});

export const globalAccess = createAccessControl(adminStatements);
export const regularUserRole = globalAccess.newRole({ user: [], session: [] });
export const superAdminRole = globalAccess.newRole({
  user: [
    "create", "list", "set-role", "ban", "impersonate", "delete",
    "set-password", "set-email", "get", "update",
  ],
  session: ["list", "revoke", "delete"],
});

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

export type ItemTraxxRole = "tenant_account" | "workspace_admin" | "super_admin";
