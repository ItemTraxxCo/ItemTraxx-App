import { readFileSync } from "node:fs";

const migrationPath = new URL(
  "../supabase/migrations/20260725221011_item_borrower_physical_rename.sql",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const policyPattern = (prefix, policyName) =>
  new RegExp(
    `${prefix}\\s+policy\\s+${prefix === "drop" ? "(?:if\\s+exists\\s+)?" : ""}(?:"${escapeRegExp(policyName)}"|${escapeRegExp(policyName)})\\s+on\\s+public\\.`,
    "i",
  );

const requireDroppedOnly = (policyName) => {
  if (!policyPattern("drop", policyName).test(migration)) {
    throw new Error(`final RLS migration does not drop legacy policy ${policyName}`);
  }
  if (policyPattern("create", policyName).test(migration)) {
    throw new Error(`final RLS migration recreates unsafe policy ${policyName}`);
  }
};

const extractParenthesizedClause = (statement, keyword) => {
  const keywordIndex = statement.toLowerCase().indexOf(keyword);
  const openIndex = statement.indexOf("(", keywordIndex + keyword.length);
  if (keywordIndex === -1 || openIndex === -1) {
    return null;
  }

  let depth = 0;
  for (let index = openIndex; index < statement.length; index += 1) {
    if (statement[index] === "(") {
      depth += 1;
    } else if (statement[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return statement.slice(openIndex + 1, index);
      }
    }
  }

  return null;
};

const normalizeSql = (value) => value
  .replace(/\s+/g, " ")
  .replace(/\s*=\s*/g, "=")
  .trim()
  .toLowerCase();

const requireStepUpPolicy = (policyName, tableName) => {
  const statement = migration.match(
    new RegExp(
      `create\\s+policy\\s+(?:"${escapeRegExp(policyName)}"|${escapeRegExp(policyName)})\\s+on\\s+public\\.${escapeRegExp(tableName)}[\\s\\S]*?;`,
      "i",
    ),
  )?.[0];

  if (!statement) {
    throw new Error(`final RLS migration does not create ${policyName}`);
  }

  if (!/\bfor\s+all\s+to\s+authenticated\b/i.test(statement)) {
    throw new Error(`${policyName} must be FOR ALL TO authenticated`);
  }

  const usingClause = extractParenthesizedClause(statement, "using");
  const withCheckClause = extractParenthesizedClause(statement, "with check");
  if (!usingClause) {
    throw new Error(`${policyName} is missing USING`);
  }
  if (!withCheckClause) {
    throw new Error(`${policyName} is missing WITH CHECK`);
  }

  const requiredPredicates = [
    /current_user_role\(\)\)\s*=\s*'workspace_admin'/i,
    /workspace_id\s*=\s*\(select\s+public\.current_workspace_id\(\)\)/i,
    /private\.current_account_session_is_active\(\)/i,
  ];

  for (const predicate of requiredPredicates) {
    if (!predicate.test(usingClause) || !predicate.test(withCheckClause)) {
      throw new Error(
        `${policyName} must enforce ${predicate} in both USING and WITH CHECK`,
      );
    }
  }

  const expectedClause = [
    "(select public.current_user_role())='workspace_admin'",
    "workspace_id=(select public.current_workspace_id())",
    "(select private.current_account_session_is_active())",
  ].join(" and ");

  if (
    normalizeSql(usingClause) !== normalizeSql(expectedClause) ||
    normalizeSql(withCheckClause) !== normalizeSql(expectedClause)
  ) {
    throw new Error(
      `${policyName} must AND-connect only the Workspace Admin, workspace, and active-session predicates in both USING and WITH CHECK`,
    );
  }
};

requireStepUpPolicy("workspace_admin_write_items", "items");
requireStepUpPolicy("workspace_admin_write_borrowers", "borrowers");

console.log("Item/borrower RLS policies require Workspace Admin role, workspace scope, and an active session.");
