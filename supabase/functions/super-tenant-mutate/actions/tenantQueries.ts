import { isMissingPostgrestColumn } from "../../_shared/postgrestErrors.ts";
import { optionalText } from "../../_shared/validation.ts";
import type { PgError, SuperTenantContext, TenantRow } from "../context.ts";
import { isMissingDistrictIdColumn } from "./districts.ts";
import { isValidTenantStatus } from "./tenantWrites.ts";

type TenantPolicyRow = {
  tenant_id: string;
  checkout_due_hours: number | null;
  account_category?: "organization" | "district" | "individual" | null;
  plan_code?:
    | "core"
    | "growth"
    | "starter"
    | "scale"
    | "enterprise"
    | "individual_yearly"
    | "individual_monthly"
    | null;
  feature_flags: Record<string, unknown> | null;
};

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

export const isMissingStatusColumn = (error: PgError | null | undefined) =>
  isMissingPostgrestColumn(error, "status");

export const isMissingPrimaryAdminColumn = (
  error: PgError | null | undefined,
) => isMissingPostgrestColumn(error, "primary_admin_profile_id");

export const defaultFeatureFlags = () => ({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_student_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});

export const enrichTenants = async (
  context: SuperTenantContext,
  rows: TenantRow[],
) => {
  if (!rows.length) return [];
  const { adminClient } = context;
  const tenantIds = Array.from(new Set(rows.map((row) => row.id)));
  const ids = Array.from(
    new Set(
      rows
        .map((row) => row.primary_admin_profile_id)
        .filter((value): value is string => !!value),
    ),
  );
  const districtIds = Array.from(
    new Set(
      rows
        .map((row) => row.district_id)
        .filter((value): value is string => !!value),
    ),
  );
  const [profileRowsResult, rawPolicyRowsResult, districtRowsResult] =
    await Promise.all([
      ids.length
        ? adminClient.from("profiles").select("id, auth_email").in("id", ids)
        : Promise.resolve({ data: [], error: null }),
      adminClient
        .from("tenant_policies")
        .select(TENANT_POLICY_SELECT)
        .in("tenant_id", tenantIds),
      districtIds.length
        ? adminClient
          .from("districts")
          .select("id, name, slug")
          .in("id", districtIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  let policyRowsResult: {
    data: Array<Record<string, unknown>> | null;
    error: PgError | null;
  } = rawPolicyRowsResult;
  const fallbackSelect = tenantPolicySelectFallback(
    rawPolicyRowsResult.error as PgError,
  );
  if (fallbackSelect) {
    const fallbackPolicyRowsResult = await adminClient
      .from("tenant_policies")
      .select(fallbackSelect)
      .in("tenant_id", tenantIds);

    policyRowsResult = {
      data: (fallbackPolicyRowsResult.data ?? []).map((item) => ({
        ...item,
        feature_flags: null,
      })),
      error: fallbackPolicyRowsResult.error,
    };
  }

  const emailById = new Map(
    (
      (profileRowsResult.data ?? []) as Array<{
        id: string;
        auth_email: string | null;
      }>
    ).map((item) => [item.id, item.auth_email]),
  );
  const policyByTenant = new Map(
    ((policyRowsResult.data ?? []) as TenantPolicyRow[]).map((item) => [
      item.tenant_id,
      item,
    ]),
  );
  const districtById = new Map(
    ((districtRowsResult.data ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
    }>).map((item) => [item.id, item]),
  );

  return rows.map((row) => ({
    ...row,
    status: row.status ?? "active",
    district_name: row.district_id
      ? districtById.get(row.district_id)?.name ?? null
      : null,
    district_slug: row.district_id
      ? districtById.get(row.district_id)?.slug ?? null
      : null,
    primary_admin_email: row.primary_admin_profile_id
      ? emailById.get(row.primary_admin_profile_id) ?? null
      : null,
    checkout_due_hours:
      typeof policyByTenant.get(row.id)?.checkout_due_hours === "number"
        ? policyByTenant.get(row.id)?.checkout_due_hours
        : 72,
    account_category:
      policyByTenant.get(row.id)?.account_category === "individual"
        ? "individual"
        : policyByTenant.get(row.id)?.account_category === "district"
        ? "district"
        : "organization",
    plan_code: policyByTenant.get(row.id)?.plan_code ?? null,
    feature_flags:
      policyByTenant.get(row.id)?.feature_flags ?? defaultFeatureFlags(),
  }));
};

export const handleListTenants = async (context: SuperTenantContext) => {
  const { adminClient, jsonResponse, payload } = context;
  const search = optionalText(payload.search, { maxLen: 120 });
  const status = optionalText(payload.status, { maxLen: 40 }) || "all";

  let query = adminClient
    .from("tenants")
    .select(
      "id, name, access_code, status, created_at, district_id, primary_admin_profile_id",
    )
    .order("created_at", { ascending: false })
    .limit(300);

  if (status !== "all" && isValidTenantStatus(status)) {
    query = query.eq("status", status);
  } else if (status !== "all") {
    return jsonResponse(400, { error: "Invalid request" });
  }

  const { data, error } = await query;
  if (error) {
    if (
      !isMissingStatusColumn(error as PgError) &&
      !isMissingPrimaryAdminColumn(error as PgError) &&
      !isMissingDistrictIdColumn(error as PgError)
    ) {
      return jsonResponse(400, { error: "Unable to load tenants." });
    }

    const fallbackQuery = adminClient
      .from("tenants")
      .select("id, name, access_code, created_at")
      .order("created_at", { ascending: false })
      .limit(300);

    const { data: fallbackData, error: fallbackError } = await fallbackQuery;
    if (fallbackError) {
      return jsonResponse(400, { error: "Unable to load tenants." });
    }

    const normalized: TenantRow[] = ((fallbackData ?? []) as TenantRow[]).map(
      (row) => ({
        ...row,
        status: "active" as const,
        district_id: null,
        primary_admin_profile_id: null,
      }),
    );

    const enriched = await enrichTenants(context, normalized);
    if (!search) {
      return jsonResponse(200, { data: enriched });
    }
    const normalizedSearch = search.toLowerCase();
    return jsonResponse(200, {
      data: enriched.filter((row) => {
        const name = typeof row.name === "string" ? row.name.toLowerCase() : "";
        const code =
          typeof row.access_code === "string"
            ? row.access_code.toLowerCase()
            : "";
        const districtName =
          typeof row.district_name === "string"
            ? row.district_name.toLowerCase()
            : "";
        const districtSlug =
          typeof row.district_slug === "string"
            ? row.district_slug.toLowerCase()
            : "";
        return (
          name.includes(normalizedSearch) ||
          code.includes(normalizedSearch) ||
          districtName.includes(normalizedSearch) ||
          districtSlug.includes(normalizedSearch)
        );
      }),
    });
  }

  const enriched = await enrichTenants(context, (data ?? []) as TenantRow[]);
  if (!search) {
    return jsonResponse(200, { data: enriched });
  }
  const normalizedSearch = search.toLowerCase();
  return jsonResponse(200, {
    data: enriched.filter((row) => {
      const name = typeof row.name === "string" ? row.name.toLowerCase() : "";
      const code =
        typeof row.access_code === "string" ? row.access_code.toLowerCase() : "";
      const districtName =
        typeof row.district_name === "string"
          ? row.district_name.toLowerCase()
          : "";
      const districtSlug =
        typeof row.district_slug === "string"
          ? row.district_slug.toLowerCase()
          : "";
      return (
        name.includes(normalizedSearch) ||
        code.includes(normalizedSearch) ||
        districtName.includes(normalizedSearch) ||
        districtSlug.includes(normalizedSearch)
      );
    }),
  });
};
