import {
  isMissingPostgrestColumn,
  isMissingPostgrestRelation,
} from "../../_shared/postgrestErrors.ts";
import type {
  DistrictRow,
  PgError,
  SuperTenantContext,
} from "../context.ts";

export const normalizeDistrictSlug = (value: string | null | undefined) =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export const isValidDistrictPlan = (
  value: unknown,
): value is
  | "district_core"
  | "district_growth"
  | "district_enterprise"
  | "organization_starter"
  | "organization_scale"
  | "organization_enterprise" =>
  value === "district_core" ||
  value === "district_growth" ||
  value === "district_enterprise" ||
  value === "organization_starter" ||
  value === "organization_scale" ||
  value === "organization_enterprise";

export const isValidDistrictBillingStatus = (
  value: unknown,
): value is "draft" | "active" | "past_due" | "canceled" =>
  value === "draft" ||
  value === "active" ||
  value === "past_due" ||
  value === "canceled";

export const describeDistrictWriteError = (
  fallback: string,
  error: PgError | null | undefined,
) => {
  if (!error) return fallback;
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("districts_subscription_plan_check")) {
    return "District subscription plan is invalid.";
  }
  if (error.code === "23505" && message.includes("slug")) {
    return "District slug already exists.";
  }
  return fallback;
};

export const isMissingDistrictsTable = (error: PgError | null | undefined) =>
  isMissingPostgrestRelation(error, "districts");

export const isMissingDistrictIdColumn = (
  error: PgError | null | undefined,
) => isMissingPostgrestColumn(error, "district_id");

export const enrichDistricts = async (
  _context: SuperTenantContext,
  rows: DistrictRow[],
) => rows;

export const handleDistrictAction = async (context: SuperTenantContext) =>
  context.jsonResponse(400, { error: "Invalid action" });
