import { isMissingPostgrestColumn } from "../../_shared/postgrestErrors.ts";
import type { PgError, SuperTenantContext } from "../context.ts";

export type TenantAccountCategory = "organization" | "district" | "individual";
export type TenantPlanCode =
  | "core"
  | "growth"
  | "starter"
  | "scale"
  | "enterprise"
  | "individual_yearly"
  | "individual_monthly";

export const TENANT_STATUSES = new Set([
  "active",
  "suspended",
  "archived",
] as const);
export const TENANT_ACCOUNT_CATEGORIES = new Set([
  "organization",
  "district",
  "individual",
] as const);
export const TENANT_PLAN_CODES = new Set([
  "core",
  "growth",
  "starter",
  "scale",
  "enterprise",
  "individual_yearly",
  "individual_monthly",
] as const);

export const isValidTenantStatus = (
  value: unknown,
): value is "active" | "suspended" | "archived" =>
  value === "active" || value === "suspended" || value === "archived";

export const isValidTenantAccountCategory = (
  value: unknown,
): value is TenantAccountCategory => TENANT_ACCOUNT_CATEGORIES.has(value as never);

export const isValidTenantPlanForAccountCategory = (
  accountCategory: TenantAccountCategory,
  planCode: TenantPlanCode | null,
) =>
  !planCode ||
  (accountCategory === "individual" &&
    (planCode === "individual_yearly" || planCode === "individual_monthly")) ||
  (accountCategory === "district" &&
    (planCode === "core" || planCode === "growth" || planCode === "enterprise")) ||
  (accountCategory === "organization" &&
    (planCode === "starter" || planCode === "scale" || planCode === "enterprise"));

export const describeTenantWriteError = (
  fallback: string,
  _error: PgError | null | undefined,
) => fallback;

type TenantPolicyFallbackOptions = {
  includeAccountCategory: boolean;
  includePlanCode: boolean;
  includeFeatureFlags: boolean;
};

const isMissingNamedColumn = (
  error: PgError | null | undefined,
  column: string,
) => isMissingPostgrestColumn(error, column, { allowSchemaCache: true });

const isAccountCategoryConstraintError = (
  error: PgError | null | undefined,
) =>
  !!error &&
  (error.code === "23514" || error.code === "P0001") &&
  (error.message ?? "")
    .toLowerCase()
    .includes("tenant_policies_account_category_check");

const isPlanCodeConstraintError = (error: PgError | null | undefined) =>
  !!error &&
  (error.code === "23514" || error.code === "P0001") &&
  (error.message ?? "")
    .toLowerCase()
    .includes("tenant_policies_plan_code_check");

export const nextTenantPolicyFallback = (
  options: TenantPolicyFallbackOptions,
  error: PgError | null | undefined,
): TenantPolicyFallbackOptions | null => {
  if (options.includeFeatureFlags && isMissingNamedColumn(error, "feature_flags")) {
    return { ...options, includeFeatureFlags: false };
  }
  if (
    options.includeAccountCategory &&
    (isMissingNamedColumn(error, "account_category") ||
      isAccountCategoryConstraintError(error))
  ) {
    return { ...options, includeAccountCategory: false };
  }
  if (
    options.includePlanCode &&
    (isMissingNamedColumn(error, "plan_code") || isPlanCodeConstraintError(error))
  ) {
    return { ...options, includePlanCode: false };
  }
  return null;
};

export const handleTenantWriteAction = async (context: SuperTenantContext) =>
  context.jsonResponse(400, { error: "Invalid action" });
