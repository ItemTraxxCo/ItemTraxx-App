import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isMissingPostgrestColumn } from "../../_shared/postgrestErrors.ts";
import {
  ACCESS_CODE_PATTERN,
  optionalText,
  requireEnum,
  requireText,
  requireUuid,
  SLUG_PATTERN,
} from "../../_shared/validation.ts";
import type { PgError, SuperTenantContext, TenantRow } from "../context.ts";
import {
  isMissingDistrictIdColumn,
  isMissingDistrictsTable,
  normalizeDistrictSlug,
} from "./districts.ts";
import {
  defaultFeatureFlags,
  enrichTenants,
  isMissingStatusColumn,
} from "./tenantQueries.ts";

export type TenantAccountCategory = "organization" | "district" | "individual";
export type TenantPlanCode =
  | "core"
  | "growth"
  | "starter"
  | "scale"
  | "enterprise"
  | "individual_yearly"
  | "individual_monthly";

export const TENANT_STATUSES = new Set(
  [
    "active",
    "suspended",
    "archived",
  ] as const,
);
export const TENANT_ACCOUNT_CATEGORIES = new Set(
  [
    "organization",
    "district",
    "individual",
  ] as const,
);
export const TENANT_PLAN_CODES = new Set(
  [
    "core",
    "growth",
    "starter",
    "scale",
    "enterprise",
    "individual_yearly",
    "individual_monthly",
  ] as const,
);

export const isValidTenantStatus = (
  value: unknown,
): value is "active" | "suspended" | "archived" =>
  value === "active" || value === "suspended" || value === "archived";

export const isValidTenantAccountCategory = (
  value: unknown,
): value is TenantAccountCategory =>
  TENANT_ACCOUNT_CATEGORIES.has(value as never);

export const isValidTenantPlanForAccountCategory = (
  accountCategory: TenantAccountCategory,
  planCode: TenantPlanCode | null,
) =>
  !planCode ||
  (accountCategory === "individual" &&
    (planCode === "individual_yearly" || planCode === "individual_monthly")) ||
  (accountCategory === "district" &&
    (planCode === "core" || planCode === "growth" ||
      planCode === "enterprise")) ||
  (accountCategory === "organization" &&
    (planCode === "starter" || planCode === "scale" ||
      planCode === "enterprise"));

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
  if (
    options.includeFeatureFlags && isMissingNamedColumn(error, "feature_flags")
  ) {
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
    (isMissingNamedColumn(error, "plan_code") ||
      isPlanCodeConstraintError(error))
  ) {
    return { ...options, includePlanCode: false };
  }
  return null;
};

type TenantPolicyUpsertInput = {
  tenant_id: string;
  checkout_due_hours?: number;
  account_category?: TenantAccountCategory | null;
  plan_code?: TenantPlanCode | null;
  feature_flags?: Record<string, unknown> | null;
  updated_by: string;
  updated_at: string;
};

const normalizeDistrictName = (value: string | null | undefined) =>
  (value ?? "").trim();

export const ensureDistrict = async (
  context: SuperTenantContext,
  districtSlug: string,
  districtName: string,
) => {
  const { adminClient } = context;
  const slug = normalizeDistrictSlug(districtSlug);
  const name = normalizeDistrictName(districtName);
  if (!slug) {
    return { districtId: null, error: "District slug is required." };
  }
  if (!name) {
    return {
      districtId: null,
      error: "District name is required when assigning a district.",
    };
  }

  const { data: existing, error: existingError } = await adminClient
    .from("districts")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();

  if (existingError) {
    if (isMissingDistrictsTable(existingError as PgError)) {
      return {
        districtId: null,
        error:
          "District foundation is not enabled yet. Run the latest database migration.",
      };
    }
    return { districtId: null, error: "Unable to load district." };
  }

  if (existing?.id) {
    if (existing.name !== name) {
      const { error: updateError } = await adminClient
        .from("districts")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (updateError) {
        return { districtId: null, error: "Unable to update district." };
      }
    }
    return { districtId: existing.id, error: null };
  }

  const { data: created, error: createError } = await adminClient
    .from("districts")
    .insert({ name, slug })
    .select("id")
    .single();

  if (createError || !created?.id) {
    return { districtId: null, error: "Unable to create district." };
  }

  return { districtId: created.id, error: null };
};

export const upsertTenantPolicy = async (
  context: SuperTenantContext,
  policy: TenantPolicyUpsertInput,
) => {
  const buildPayload = (options: TenantPolicyFallbackOptions) => ({
    tenant_id: policy.tenant_id,
    checkout_due_hours: policy.checkout_due_hours ?? 72,
    ...(options.includeAccountCategory
      ? { account_category: policy.account_category ?? null }
      : {}),
    ...(options.includePlanCode ? { plan_code: policy.plan_code ?? null } : {}),
    ...(options.includeFeatureFlags && policy.feature_flags !== undefined
      ? { feature_flags: policy.feature_flags ?? defaultFeatureFlags() }
      : {}),
    updated_by: policy.updated_by,
    updated_at: policy.updated_at,
  });

  let options: TenantPolicyFallbackOptions = {
    includeAccountCategory: true,
    includePlanCode: true,
    includeFeatureFlags: true,
  };

  for (;;) {
    const result = await context.adminClient.from("tenant_policies").upsert(
      buildPayload(options),
      { onConflict: "tenant_id" },
    );
    if (!result.error) return result;

    const fallback = nextTenantPolicyFallback(options, result.error as PgError);
    if (!fallback) return result;
    options = fallback;
  }
};

const verifySuperPassword = async (
  supabaseUrl: string,
  publishableKey: string,
  email: string,
  password: string,
) => {
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
  });
  const { error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  return !error;
};

export const handleTenantWriteAction = async (context: SuperTenantContext) => {
  const {
    action,
    adminClient,
    jsonResponse,
    payload,
    profile,
    publishableKey,
    supabaseUrl,
    user,
    writeAudit,
  } = context;

  if (action === "update_tenant") {
    const next = payload;
    const id = requireUuid(next.id);
    const name = requireText(next.name, { maxLen: 120 });
    const accessCode = requireText(next.access_code, {
      maxLen: 64,
      pattern: ACCESS_CODE_PATTERN,
    });
    const accountCategory = next.account_category === undefined ||
        next.account_category === null ||
        next.account_category === ""
      ? "organization"
      : requireEnum(next.account_category, TENANT_ACCOUNT_CATEGORIES);
    const planCode = next.plan_code === undefined || next.plan_code === null ||
        next.plan_code === ""
      ? null
      : requireEnum(next.plan_code, TENANT_PLAN_CODES);
    const districtSlugRaw = optionalText(next.district_slug, { maxLen: 80 });
    const districtSlug = districtSlugRaw
      ? requireText(normalizeDistrictSlug(districtSlugRaw), {
        maxLen: 63,
        pattern: SLUG_PATTERN,
      })
      : "";
    const districtName = optionalText(next.district_name, { maxLen: 120 });
    if ((districtSlug && !districtName) || (!districtSlug && districtName)) {
      return jsonResponse(400, {
        error:
          "District name and slug must both be provided when assigning a district.",
      });
    }
    if (!isValidTenantPlanForAccountCategory(accountCategory, planCode)) {
      return jsonResponse(400, {
        error: "Invalid plan for tenant account category.",
      });
    }
    if (accountCategory === "individual" && (districtSlug || districtName)) {
      return jsonResponse(400, {
        error: "Individual accounts cannot be assigned to a district.",
      });
    }

    let districtId: string | null = null;
    if (districtSlug && districtName) {
      const districtResult = await ensureDistrict(
        context,
        districtSlug,
        districtName,
      );
      if (districtResult.error) {
        return jsonResponse(400, { error: districtResult.error });
      }
      districtId = districtResult.districtId;
    }

    const { data, error } = await adminClient
      .from("tenants")
      .update({ name, access_code: accessCode, district_id: districtId })
      .eq("id", id)
      .select(
        "id, name, access_code, status, created_at, district_id, primary_admin_profile_id",
      )
      .single();

    if (error || !data) {
      if (isMissingDistrictIdColumn(error as PgError)) {
        return jsonResponse(400, {
          error:
            "District foundation is not enabled yet. Run the latest database migration.",
        });
      }
      return jsonResponse(400, {
        error: describeTenantWriteError(
          "Unable to update tenant.",
          error as PgError,
        ),
      });
    }

    const { error: policyError } = await upsertTenantPolicy(context, {
      tenant_id: id,
      account_category: accountCategory,
      plan_code: planCode,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });

    if (policyError) {
      console.error("super-tenant-mutate tenant policy update failed", {
        code: policyError.code,
        message: policyError.message,
        details: policyError.details,
        hint: policyError.hint,
        accountCategory,
        planCode,
        tenantId: id,
      });
      return jsonResponse(400, {
        error: "Unable to update tenant plan details.",
      });
    }

    await writeAudit("update_tenant", "tenant", data.id, {
      tenant_name: data.name,
      account_category: accountCategory,
      plan_code: planCode,
      district_slug: districtSlug || null,
    });

    return jsonResponse(200, {
      data: (await enrichTenants(context, [data as TenantRow]))[0],
    });
  }

  if (action === "set_tenant_status") {
    const next = payload;
    const id = requireUuid(next.id);
    const status = requireEnum(next.status, TENANT_STATUSES);
    const superPassword = requireText(next.super_password, { maxLen: 1024 });
    const confirmPhrase = requireText(next.confirm_phrase, { maxLen: 32 });

    if (confirmPhrase !== "CONFIRM") {
      return jsonResponse(400, { error: "Confirmation phrase mismatch." });
    }

    const verified = await verifySuperPassword(
      supabaseUrl,
      publishableKey,
      profile.auth_email ?? user.email ?? "",
      superPassword,
    );
    if (!verified) {
      return jsonResponse(403, {
        error: "Super password verification failed.",
      });
    }

    const { data, error } = await adminClient
      .from("tenants")
      .update({ status })
      .eq("id", id)
      .select(
        "id, name, access_code, status, created_at, district_id, primary_admin_profile_id",
      )
      .single();

    if (error || !data) {
      if (isMissingStatusColumn(error as PgError)) {
        return jsonResponse(400, {
          error:
            "Tenant status is not enabled yet. Run the latest database migration.",
        });
      }
      return jsonResponse(400, { error: "Unable to update tenant status." });
    }

    await writeAudit(
      status === "suspended"
        ? "suspend_tenant"
        : status === "archived"
        ? "archive_tenant"
        : "reactivate_tenant",
      "tenant",
      data.id,
      { tenant_name: data.name, status: data.status },
    );

    return jsonResponse(200, {
      data: (await enrichTenants(context, [data as TenantRow]))[0],
    });
  }

  return jsonResponse(400, { error: "Invalid action" });
};
