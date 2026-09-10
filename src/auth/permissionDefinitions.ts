/**
 * Shared ItemTraxx authorization statements.
 *
 * This module intentionally has no Better Auth imports. The Cloudflare Worker
 * installs its own dependency tree, while the Vue app installs the root tree;
 * keeping the policy data dependency-free lets both runtimes build from the
 * same source of truth.
 */
export const organizationStatements = {
  itemtraxxWorkspace: ["read", "operate", "administer"],
  enterpriseSso: ["read", "create", "update", "delete", "verify-domain"],
} as const;

export const tenantAccountRoleStatements = {
  itemtraxxWorkspace: ["read", "operate"],
  enterpriseSso: [],
  organization: [],
  member: [],
  invitation: [],
} as const;

export const workspaceAdminRoleStatements = {
  itemtraxxWorkspace: ["read", "operate", "administer"],
  enterpriseSso: ["read", "create", "update", "delete", "verify-domain"],
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
} as const;

export const regularUserRoleStatements = {
  user: [],
  session: [],
} as const;

export const superAdminRoleStatements = {
  user: [
    "create", "list", "set-role", "ban", "impersonate", "delete",
    "set-password", "set-email", "get", "update",
  ],
  session: ["list", "revoke", "delete"],
} as const;
