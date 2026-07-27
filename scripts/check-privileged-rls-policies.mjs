import { readFileSync } from "node:fs";

// Static guard over the migrations that define the browser-reachable database
// surface. This exists because the workspace-model redesign silently widened
// that surface -- it granted `authenticated` table-wide write privileges and
// dropped the step-up predicate that every privileged policy used to carry --
// and nothing in CI noticed. Each assertion below encodes one invariant that,
// if it regresses, re-opens a finding from the July 2026 security audit.
//
// The checks are textual because CI has no database. They verify what the
// migrations declare, not what production actually has; see
// ITEMTRAXX_SECURITY_AUDIT.md section 9 for that limitation.

const readMigration = (name) =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

const RENAME_MIGRATION = "20260725221011_item_borrower_physical_rename.sql";
const LEAST_PRIVILEGE_MIGRATION = "20260726120000_least_privilege_rest_surface.sql";

const renameMigration = readMigration(RENAME_MIGRATION);
const leastPrivilege = readMigration(LEAST_PRIVILEGE_MIGRATION);

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeSql = (value) =>
  value.replace(/\s+/g, " ").replace(/\s*=\s*/g, "=").trim().toLowerCase();

// ---------------------------------------------------------------------------
// 1. Member SELECT policies must keep enforcing workspace scope and an active
//    session. These are the policies the SPA actually reads through, so they
//    are the ones that must never loosen.
// ---------------------------------------------------------------------------
const extractPolicyStatement = (sql, policyName, tableName) =>
  sql.match(
    new RegExp(
      `create\\s+policy\\s+(?:"${escapeRegExp(policyName)}"|${escapeRegExp(policyName)})\\s+on\\s+public\\.${escapeRegExp(tableName)}[\\s\\S]*?;`,
      "i",
    ),
  )?.[0] ?? null;

const requireMemberSelectPolicy = (policyName, tableName) => {
  const statement = extractPolicyStatement(renameMigration, policyName, tableName);
  if (!statement) {
    failures.push(`${RENAME_MIGRATION} no longer creates ${policyName}`);
    return;
  }
  check(
    /\bfor\s+select\s+to\s+authenticated\b/i.test(statement),
    `${policyName} must remain FOR SELECT TO authenticated`,
  );
  for (
    const [label, predicate] of [
      ["workspace scope", /workspace_id\s*=\s*\(select\s+public\.current_workspace_id\(\)\)/i],
      ["active session", /private\.current_account_session_is_active\(\)/i],
      ["soft-delete filter", /deleted_at\s+is\s+null/i],
    ]
  ) {
    check(predicate.test(statement), `${policyName} must enforce ${label}`);
  }
};

requireMemberSelectPolicy("workspace_members_select_items", "items");
requireMemberSelectPolicy("workspace_members_select_borrowers", "borrowers");

// ---------------------------------------------------------------------------
// 2. The workspace-admin direct write path must stay closed. These policies and
//    grants let a workspace admin bypass admin-item-mutate / admin-borrower-mutate
//    (validation, checkout guards, soft delete, audit logging) and rewrite
//    workspace_policies entitlements with a single PATCH.
// ---------------------------------------------------------------------------
for (
  const [policyName, tableName] of [
    ["workspace_admin_write_items", "items"],
    ["workspace_admin_write_borrowers", "borrowers"],
    ["workspace_admin_write_policies", "workspace_policies"],
    ["workspace_admin_write_item_status_history", "item_status_history"],
    ["access_grants_workspace_admin_all_items", "item_access_grants"],
    ["access_grants_workspace_admin_all_borrowers", "borrower_access_grants"],
  ]
) {
  check(
    new RegExp(
      `drop\\s+policy\\s+if\\s+exists\\s+${escapeRegExp(policyName)}\\s+on\\s+public\\.${escapeRegExp(tableName)}`,
      "i",
    ).test(leastPrivilege),
    `${LEAST_PRIVILEGE_MIGRATION} must drop the direct-write policy ${policyName}`,
  );
  check(
    !extractPolicyStatement(leastPrivilege, policyName, tableName),
    `${LEAST_PRIVILEGE_MIGRATION} must not recreate the direct-write policy ${policyName}`,
  );
}

for (
  const table of [
    "workspace_policies",
    "items",
    "borrowers",
    "item_status_history",
    "item_access_grants",
    "borrower_access_grants",
  ]
) {
  check(
    new RegExp(
      `revoke\\s+insert,\\s*update,\\s*delete\\s+on\\s+public\\.${escapeRegExp(table)}\\s+from\\s+authenticated`,
      "i",
    ).test(leastPrivilege),
    `${LEAST_PRIVILEGE_MIGRATION} must revoke write privileges on ${table} from authenticated`,
  );
}

check(
  /revoke\s+update,\s*delete\s+on\s+public\.admin_audit_logs\s+from\s+authenticated/i.test(leastPrivilege),
  `${LEAST_PRIVILEGE_MIGRATION} must revoke update/delete on admin_audit_logs from authenticated`,
);

// The browser audit-log insert (src/services/auditLogService.ts) is the one
// write that must survive. Guard against an over-broad future revoke.
check(
  !/revoke[^;]*\binsert\b[^;]*on\s+public\.admin_audit_logs\s+from\s+authenticated/i.test(leastPrivilege),
  `${LEAST_PRIVILEGE_MIGRATION} must not revoke INSERT on admin_audit_logs (breaks auditLogService.ts)`,
);

// ---------------------------------------------------------------------------
// 3. Access-grant tables keep a read path. Dropping these outright would break
//    the admin Items/Borrowers access pickers, which read them directly.
// ---------------------------------------------------------------------------
for (
  const [policyName, tableName] of [
    ["access_grants_workspace_admin_select_items", "item_access_grants"],
    ["access_grants_workspace_admin_select_borrowers", "borrower_access_grants"],
  ]
) {
  const statement = extractPolicyStatement(leastPrivilege, policyName, tableName);
  if (!statement) {
    failures.push(`${LEAST_PRIVILEGE_MIGRATION} must create ${policyName}`);
    continue;
  }
  check(
    /\bfor\s+select\s+to\s+authenticated\b/i.test(statement),
    `${policyName} must be FOR SELECT TO authenticated`,
  );
  check(
    /private\.current_account_session_is_active\(\)/i.test(statement),
    `${policyName} must enforce an active session`,
  );
}

// ---------------------------------------------------------------------------
// 4. Super-admin policies must require a live step-up and a non-revoked
//    session, so the RLS path matches what every super-* edge function checks.
// ---------------------------------------------------------------------------
const SUPER_ADMIN_POLICIES = [
  "super_admin_all_workspaces",
  "super_admin_all_profiles",
  "super_admin_all_items",
  "super_admin_all_borrowers",
  "super_admin_all_item_logs",
  "super_admin_all_item_status_history",
  "super_admin_all_policies",
  "super_admin_all_security_controls",
  "super_admin_all_audit",
];

for (const policyName of SUPER_ADMIN_POLICIES) {
  check(
    new RegExp(`'${escapeRegExp(policyName)}'`).test(leastPrivilege),
    `${LEAST_PRIVILEGE_MIGRATION} must rebuild ${policyName}`,
  );
}

const superAdminPolicyBody = leastPrivilege.match(
  /create\s+policy\s+%I\s+on\s+public\.%I[\s\S]*?\$fmt\$/i,
)?.[0];

if (!superAdminPolicyBody) {
  failures.push(
    `${LEAST_PRIVILEGE_MIGRATION} must contain the templated super-admin policy body`,
  );
} else {
  const normalized = normalizeSql(superAdminPolicyBody);
  const roleChecks = (normalized.match(/current_user_role\(\)\)='super_admin'/g) ?? []).length;
  const stepUpChecks = (normalized.match(/has_recent_privileged_step_up\('super_admin'\)/g) ?? []).length;
  const revocationChecks = (normalized.match(/super_admin_session_not_revoked\(\)/g) ?? []).length;

  // Twice each: once in USING, once in WITH CHECK.
  check(roleChecks >= 2, "super-admin policy body must check the role in USING and WITH CHECK");
  check(stepUpChecks >= 2, "super-admin policy body must require step-up in USING and WITH CHECK");
  check(
    revocationChecks >= 2,
    "super-admin policy body must require a non-revoked session in USING and WITH CHECK",
  );
}

check(
  /create\s+or\s+replace\s+function\s+private\.super_admin_session_not_revoked\(\)/i.test(leastPrivilege),
  `${LEAST_PRIVILEGE_MIGRATION} must define private.super_admin_session_not_revoked()`,
);

check(
  !/when\s+\(select\s+public\.current_user_role\(\)\)\s*=\s*'super_admin'\s*then\s+true/i.test(leastPrivilege),
  "private.current_account_session_is_active() must not return an unconditional true for super admins",
);

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error("Privileged RLS invariants failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  [
    "Privileged RLS invariants hold:",
    "- workspace member SELECT policies enforce workspace scope, active session, and soft-delete filtering",
    "- workspace-admin direct write policies and grants are removed on items, borrowers,",
    "  item_status_history, workspace_policies, and both access-grant tables",
    "- admin_audit_logs keeps INSERT for the browser audit path and nothing else",
    "- access-grant read paths are preserved as FOR SELECT",
    `- all ${SUPER_ADMIN_POLICIES.length} super-admin policies require step-up and a non-revoked session`,
  ].join("\n"),
);
