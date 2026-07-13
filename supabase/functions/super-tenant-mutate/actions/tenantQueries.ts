import { isMissingPostgrestColumn } from "../../_shared/postgrestErrors.ts";
import type { PgError, SuperTenantContext, TenantRow } from "../context.ts";

export const TENANT_POLICY_SELECT =
  "tenant_id, checkout_due_hours, account_category, plan_code, feature_flags";
export const TENANT_POLICY_SELECT_WITHOUT_FEATURE_FLAGS =
  "tenant_id, checkout_due_hours, account_category, plan_code";

export const tenantPolicySelectFallback = (
  error: PgError | null | undefined,
) =>
  isMissingPostgrestColumn(error, "feature_flags", { allowSchemaCache: true })
    ? TENANT_POLICY_SELECT_WITHOUT_FEATURE_FLAGS
    : null;

export const enrichTenants = async (
  _context: SuperTenantContext,
  rows: TenantRow[],
) => rows;

export const handleListTenants = async (context: SuperTenantContext) =>
  context.jsonResponse(400, { error: "Invalid action" });
