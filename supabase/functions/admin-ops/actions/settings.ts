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
  enable_bulk_borrower_tools: true,
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
    enable_bulk_borrower_tools:
      typeof payload.enable_bulk_borrower_tools === "boolean"
        ? payload.enable_bulk_borrower_tools
        : fallback.enable_bulk_borrower_tools,
    enable_status_tracking: typeof payload.enable_status_tracking === "boolean"
      ? payload.enable_status_tracking
      : fallback.enable_status_tracking,
    enable_barcode_generator:
      typeof payload.enable_barcode_generator === "boolean"
        ? payload.enable_barcode_generator
        : fallback.enable_barcode_generator,
  };
};

export const resolveWorkspacePolicyState = async (
  adminClient: SupabaseClient,
  workspaceId: string,
): Promise<{
  workspacePolicy: TenantPolicyRow | null;
  checkoutDueHours: number;
  featureFlags: TenantFeatureFlags;
}> => {
  let tenantPolicyResult: TenantPolicyResult = await adminClient
    .from("workspace_policies")
    .select("checkout_due_hours, account_category, plan_code, feature_flags")
    .eq("workspace_id", workspaceId)
    .maybeSingle() as unknown as TenantPolicyResult;

  if (isMissingColumn(tenantPolicyResult.error, "feature_flags")) {
    const fallbackTenantPolicyResult = await adminClient
      .from("workspace_policies")
      .select("checkout_due_hours, account_category, plan_code")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    tenantPolicyResult = {
      data: fallbackTenantPolicyResult.data
        ? { ...fallbackTenantPolicyResult.data, feature_flags: null }
        : null,
      error: fallbackTenantPolicyResult.error,
    } as TenantPolicyResult;
  }

  const workspacePolicy = tenantPolicyResult.data;
  let checkoutDueHours = 72;
  let featureFlags = defaultFeatureFlags();
  if (!tenantPolicyResult.error && workspacePolicy) {
    if (typeof workspacePolicy.checkout_due_hours === "number") {
      checkoutDueHours = Math.min(
        720,
        Math.max(1, Math.round(workspacePolicy.checkout_due_hours)),
      );
    }
    featureFlags = normalizeFeatureFlags(workspacePolicy.feature_flags);
  }
  return { workspacePolicy, checkoutDueHours, featureFlags };
};

export const handleSettingsAction = async (
  context: AdminOpsContext,
): Promise<Response> => {
  if (context.action === "get_workspace_dashboard") {
    const [accountsResult, itemResult, borrowersResult, itemGrantsResult, borrowerGrantsResult, logsResult] =
      await Promise.all([
        context.adminClient.from("profiles").select("id,auth_email").eq("workspace_id", context.workspaceId).eq("role", "tenant_account").eq("is_active", true).is("deleted_at", null),
        context.adminClient.from("items").select("id,access_mode,status,checked_out_at").eq("workspace_id", context.workspaceId).is("deleted_at", null),
        context.adminClient.from("borrowers").select("id,access_mode").eq("workspace_id", context.workspaceId).is("deleted_at", null),
        context.adminClient.from("item_access_grants").select("item_id,profile_id"),
        context.adminClient.from("borrower_access_grants").select("borrower_id,profile_id"),
        context.adminClient.from("item_logs").select("item_id,performed_by,action_type,action_time").eq("workspace_id", context.workspaceId).order("action_time", { ascending: false }),
      ]);
    const error = [accountsResult, itemResult, borrowersResult, itemGrantsResult, borrowerGrantsResult, logsResult]
      .find((result) => result.error)?.error;
    if (error) {
      return context.jsonResponse(400, {
        error: "Unable to load workspace dashboard.",
      });
    }
    const item = itemResult.data ?? [];
    const borrowers = borrowersResult.data ?? [];
    const itemGrants = new Set((itemGrantsResult.data ?? []).map((grant) => `${grant.profile_id}:${grant.item_id}`));
    const borrowerGrants = new Set((borrowerGrantsResult.data ?? []).map((grant) => `${grant.profile_id}:${grant.borrower_id}`));
    const latestByItem = new Map<string, { performed_by: string | null; action_type: string | null }>();
    for (const log of logsResult.data ?? []) {
      if (!latestByItem.has(log.item_id)) latestByItem.set(log.item_id, log);
    }
    const overdueCutoff = Date.now() - context.checkoutDueHours * 60 * 60 * 1000;
    const data = (accountsResult.data ?? []).map((account) => {
      const accessibleItem = item.filter((item) => item.access_mode === "all" || itemGrants.has(`${account.id}:${item.id}`));
      const latestForAccount = accessibleItem.filter((item) => {
        const latest = latestByItem.get(item.id);
        return !!latest && latest.performed_by === account.id && latest.action_type === "checkout";
      });
      return {
        profile_id: account.id,
        auth_email: account.auth_email ?? "",
        item_count: accessibleItem.length,
        borrower_count: borrowers.filter((borrower) => borrower.access_mode === "all" || borrowerGrants.has(`${account.id}:${borrower.id}`)).length,
        active_checkouts: latestForAccount.length,
        overdue_count: latestForAccount.filter((item) => item.checked_out_at && Date.parse(item.checked_out_at) < overdueCutoff).length,
      };
    });
    return context.jsonResponse(200, { data });
  }

  if (context.action === "get_workspace_settings") {
    return context.jsonResponse(200, {
      data: {
        checkout_due_hours: context.checkoutDueHours,
        account_category:
          context.workspacePolicy?.account_category === "individual"
            ? "individual"
            : context.workspacePolicy?.account_category === "district"
            ? "district"
            : context.workspacePolicy?.account_category === "organization"
            ? "organization"
            : null,
        plan_code: context.workspacePolicy?.plan_code ?? null,
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
    workspace_id: context.workspaceId,
    checkout_due_hours: checkoutDueHoursNext,
    updated_by: context.user.id,
    updated_at: new Date().toISOString(),
  };

  let settingsResult: TenantPolicyResult = await context.adminClient
    .from("workspace_policies")
    .upsert(row, { onConflict: "workspace_id" })
    .select("checkout_due_hours, account_category, plan_code, feature_flags")
    .single() as unknown as TenantPolicyResult;

  if (isMissingColumn(settingsResult.error, "feature_flags")) {
    const fallbackSettingsResult = await context.adminClient
      .from("workspace_policies")
      .upsert(row, { onConflict: "workspace_id" })
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
