import { isMissingPostgrestColumn as isMissingColumn } from "../../_shared/postgrestErrors.ts";
import { optionalInteger } from "../../_shared/validation.ts";
import type {
  AdminOpsContext,
  RpcError,
  SupabaseClient,
  TenantFeatureFlags,
  TenantPolicyRow,
} from "../context.ts";

type TenantPolicyResult = {
  data: TenantPolicyRow | null;
  error: RpcError | null;
};

export const defaultFeatureFlags = (): TenantFeatureFlags => ({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_student_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});

export const normalizeFeatureFlags = (value: unknown): TenantFeatureFlags => {
  if (!value || typeof value !== "object") return defaultFeatureFlags();
  const payload = value as Record<string, unknown>;
  const fallback = defaultFeatureFlags();
  return {
    enable_notifications: typeof payload.enable_notifications === "boolean"
      ? payload.enable_notifications
      : fallback.enable_notifications,
    enable_bulk_item_import:
      typeof payload.enable_bulk_item_import === "boolean"
        ? payload.enable_bulk_item_import
        : fallback.enable_bulk_item_import,
    enable_bulk_student_tools:
      typeof payload.enable_bulk_student_tools === "boolean"
        ? payload.enable_bulk_student_tools
        : fallback.enable_bulk_student_tools,
    enable_status_tracking: typeof payload.enable_status_tracking === "boolean"
      ? payload.enable_status_tracking
      : fallback.enable_status_tracking,
    enable_barcode_generator:
      typeof payload.enable_barcode_generator === "boolean"
        ? payload.enable_barcode_generator
        : fallback.enable_barcode_generator,
  };
};

export const resolveTenantPolicyState = async (
  adminClient: SupabaseClient,
  tenantId: string,
): Promise<{
  tenantPolicy: TenantPolicyRow | null;
  checkoutDueHours: number;
  featureFlags: TenantFeatureFlags;
}> => {
  let tenantPolicyResult: TenantPolicyResult = await adminClient
    .from("tenant_policies")
    .select("checkout_due_hours, account_category, plan_code, feature_flags")
    .eq("tenant_id", tenantId)
    .maybeSingle() as unknown as TenantPolicyResult;

  if (isMissingColumn(tenantPolicyResult.error, "feature_flags")) {
    const fallbackTenantPolicyResult = await adminClient
      .from("tenant_policies")
      .select("checkout_due_hours, account_category, plan_code")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    tenantPolicyResult = {
      data: fallbackTenantPolicyResult.data
        ? { ...fallbackTenantPolicyResult.data, feature_flags: null }
        : null,
      error: fallbackTenantPolicyResult.error,
    } as TenantPolicyResult;
  }

  const tenantPolicy = tenantPolicyResult.data;
  let checkoutDueHours = 72;
  let featureFlags = defaultFeatureFlags();
  if (!tenantPolicyResult.error && tenantPolicy) {
    if (typeof tenantPolicy.checkout_due_hours === "number") {
      checkoutDueHours = Math.min(
        720,
        Math.max(1, Math.round(tenantPolicy.checkout_due_hours)),
      );
    }
    featureFlags = normalizeFeatureFlags(tenantPolicy.feature_flags);
  }
  return { tenantPolicy, checkoutDueHours, featureFlags };
};

export const handleSettingsAction = async (
  context: AdminOpsContext,
): Promise<Response> => {
  if (context.action === "get_tenant_settings") {
    return context.jsonResponse(200, {
      data: {
        checkout_due_hours: context.checkoutDueHours,
        account_category:
          context.tenantPolicy?.account_category === "individual"
            ? "individual"
            : context.tenantPolicy?.account_category === "district"
            ? "district"
            : context.tenantPolicy?.account_category === "organization"
            ? "organization"
            : null,
        plan_code: context.tenantPolicy?.plan_code ?? null,
        feature_flags: context.featureFlags,
      },
    });
  }

  const checkoutDueHoursNext = optionalInteger(
    context.payload.checkout_due_hours,
    1,
    720,
    24,
  );
  const row = {
    tenant_id: context.tenantId,
    checkout_due_hours: checkoutDueHoursNext,
    updated_by: context.user.id,
    updated_at: new Date().toISOString(),
  };

  let settingsResult: TenantPolicyResult = await context.adminClient
    .from("tenant_policies")
    .upsert(row, { onConflict: "tenant_id" })
    .select("checkout_due_hours, account_category, plan_code, feature_flags")
    .single() as unknown as TenantPolicyResult;

  if (isMissingColumn(settingsResult.error, "feature_flags")) {
    const fallbackSettingsResult = await context.adminClient
      .from("tenant_policies")
      .upsert(row, { onConflict: "tenant_id" })
      .select("checkout_due_hours, account_category, plan_code")
      .single();
    settingsResult = {
      data: fallbackSettingsResult.data
        ? { ...fallbackSettingsResult.data, feature_flags: null }
        : null,
      error: fallbackSettingsResult.error,
    } as TenantPolicyResult;
  }

  const { data, error } = settingsResult;
  if (error || !data) {
    return context.jsonResponse(400, {
      error: "Unable to save tenant settings.",
    });
  }
  return context.jsonResponse(200, {
    data: {
      checkout_due_hours: typeof data.checkout_due_hours === "number"
        ? data.checkout_due_hours
        : checkoutDueHoursNext,
      account_category: data.account_category === "individual"
        ? "individual"
        : data.account_category === "district"
        ? "district"
        : data.account_category === "organization"
        ? "organization"
        : null,
      plan_code: data.plan_code ?? null,
      feature_flags: normalizeFeatureFlags(data.feature_flags),
    },
  });
};
