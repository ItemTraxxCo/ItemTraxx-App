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

export const individualAccountRoleStatements = {
  itemtraxxWorkspace: ["read", "operate", "administer"],
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

// Super-admin user and session administration runs through the ItemTraxx
// console edge functions (step-up, live-session and audit enforced there).
// The Better Auth admin plugin routes are closed in the Worker, so the role
// carries no plugin permissions that could authorize them if that block were
// ever removed.
export const superAdminRoleStatements = {
  user: [],
  session: [],
} as const;
