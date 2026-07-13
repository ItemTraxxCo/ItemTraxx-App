import {
  isMissingPostgrestColumn,
  isMissingPostgrestRelation,
} from "../../_shared/postgrestErrors.ts";
import {
  optionalEmail,
  optionalText,
  requireText,
  requireUuid,
  SLUG_PATTERN,
} from "../../_shared/validation.ts";
import type {
  DistrictRow,
  PgError,
  SuperTenantContext,
  TenantRow,
} from "../context.ts";
import { enrichTenants } from "./tenantQueries.ts";

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
  context: SuperTenantContext,
  rows: DistrictRow[],
) => {
  if (!rows.length) return [];

  const districtIds = rows.map((row) => row.id);
  const { data: tenantCounts, error: tenantCountsError } = await context.adminClient
    .from("tenants")
    .select("district_id")
    .in("district_id", districtIds);

  const countsByDistrict = new Map<string, number>();
  if (!tenantCountsError) {
    for (const row of (tenantCounts ?? []) as Array<{ district_id: string | null }>) {
      if (!row.district_id) continue;
      countsByDistrict.set(row.district_id, (countsByDistrict.get(row.district_id) ?? 0) + 1);
    }
  }

  return rows.map((row) => ({
    ...row,
    is_active: row.is_active !== false,
    tenants_count: countsByDistrict.get(row.id) ?? 0,
  }));
};

export const handleDistrictAction = async (context: SuperTenantContext) => {
  const { action, adminClient, jsonResponse, payload, writeAudit } = context;

    if (action === "list_districts") {
      const search = optionalText(payload.search, { maxLen: 120, transform: "lowercase" });

      const { data, error } = await adminClient
        .from("districts")
        .select("id, name, slug, support_email, contact_name, is_active, created_at, subscription_plan, billing_status, renewal_date, billing_email, invoice_reference")
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) {
        if (isMissingDistrictsTable(error as PgError)) {
          return jsonResponse(400, {
            error: "District foundation is not enabled yet. Run the latest database migration.",
          });
        }
        return jsonResponse(400, { error: "Unable to load districts." });
      }

      const enriched = await enrichDistricts(context, (data ?? []) as DistrictRow[]);
      if (!search) {
        return jsonResponse(200, { data: enriched });
      }

      return jsonResponse(200, {
        data: enriched.filter((row) => {
          const name = (row.name ?? "").toLowerCase();
          const slug = (row.slug ?? "").toLowerCase();
          const supportEmail = (row.support_email ?? "").toLowerCase();
          return (
            name.includes(search) || slug.includes(search) || supportEmail.includes(search)
          );
        }),
      });
    }

    if (action === "create_district") {
      const next = payload;
      const name = requireText(next.name, { maxLen: 120 });
      const slug = requireText(normalizeDistrictSlug(optionalText(next.slug, { maxLen: 80 })), {
        maxLen: 63,
        pattern: SLUG_PATTERN,
      });
      const supportEmail = optionalEmail(next.support_email);
      const contactName = optionalText(next.contact_name, { maxLen: 120 });
      const subscriptionPlan = next.subscription_plan;
      const billingStatus = next.billing_status;
      const renewalDate = optionalText(next.renewal_date, { maxLen: 40 }) || null;
      const billingEmail = optionalEmail(next.billing_email) || null;
      const invoiceReference = optionalText(next.invoice_reference, { maxLen: 120 }) || null;
      if (subscriptionPlan != null && subscriptionPlan !== "" && !isValidDistrictPlan(subscriptionPlan)) {
        return jsonResponse(400, { error: "Invalid subscription plan." });
      }
      if (billingStatus != null && billingStatus !== "" && !isValidDistrictBillingStatus(billingStatus)) {
        return jsonResponse(400, { error: "Invalid billing status." });
      }

      const { data, error } = await adminClient
        .from("districts")
        .insert({
          name,
          slug,
          support_email: supportEmail || null,
          contact_name: contactName || null,
          subscription_plan: isValidDistrictPlan(subscriptionPlan) ? subscriptionPlan : null,
          billing_status: isValidDistrictBillingStatus(billingStatus) ? billingStatus : null,
          renewal_date: renewalDate,
          billing_email: billingEmail,
          invoice_reference: invoiceReference,
        })
        .select("id, name, slug, support_email, contact_name, is_active, created_at, subscription_plan, billing_status, renewal_date, billing_email, invoice_reference")
        .single();

      if (error || !data) {
        if (isMissingDistrictsTable(error as PgError)) {
          return jsonResponse(400, {
            error: "District foundation is not enabled yet. Run the latest database migration.",
          });
        }
        return jsonResponse(400, {
          error: describeDistrictWriteError("Unable to create district.", error as PgError),
        });
      }

      await writeAudit("create_district", "district", data.id, {
        district_name: data.name,
        district_slug: data.slug,
      });

      return jsonResponse(200, { data: (await enrichDistricts(context, [data as DistrictRow]))[0] });
    }

    if (action === "update_district") {
      const next = payload;
      const id = requireUuid(next.id);
      const name = requireText(next.name, { maxLen: 120 });
      const slug = requireText(normalizeDistrictSlug(optionalText(next.slug, { maxLen: 80 })), {
        maxLen: 63,
        pattern: SLUG_PATTERN,
      });
      const supportEmail = optionalEmail(next.support_email);
      const contactName = optionalText(next.contact_name, { maxLen: 120 });
      const isActive = next.is_active !== false;
      const subscriptionPlan = next.subscription_plan;
      const billingStatus = next.billing_status;
      const renewalDate = optionalText(next.renewal_date, { maxLen: 40 }) || null;
      const billingEmail = optionalEmail(next.billing_email) || null;
      const invoiceReference = optionalText(next.invoice_reference, { maxLen: 120 }) || null;
      if (subscriptionPlan != null && subscriptionPlan !== "" && !isValidDistrictPlan(subscriptionPlan)) {
        return jsonResponse(400, { error: "Invalid subscription plan." });
      }
      if (billingStatus != null && billingStatus !== "" && !isValidDistrictBillingStatus(billingStatus)) {
        return jsonResponse(400, { error: "Invalid billing status." });
      }

      const { data, error } = await adminClient
        .from("districts")
        .update({
          name,
          slug,
          support_email: supportEmail || null,
          contact_name: contactName || null,
          is_active: isActive,
          subscription_plan: isValidDistrictPlan(subscriptionPlan) ? subscriptionPlan : null,
          billing_status: isValidDistrictBillingStatus(billingStatus) ? billingStatus : null,
          renewal_date: renewalDate,
          billing_email: billingEmail,
          invoice_reference: invoiceReference,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id, name, slug, support_email, contact_name, is_active, created_at, subscription_plan, billing_status, renewal_date, billing_email, invoice_reference")
        .single();

      if (error || !data) {
        if (isMissingDistrictsTable(error as PgError)) {
          return jsonResponse(400, {
            error: "District foundation is not enabled yet. Run the latest database migration.",
          });
        }
        return jsonResponse(400, {
          error: describeDistrictWriteError("Unable to update district.", error as PgError),
        });
      }

      await writeAudit("update_district", "district", data.id, {
        district_name: data.name,
        district_slug: data.slug,
        is_active: data.is_active ?? true,
        subscription_plan: data.subscription_plan ?? null,
        billing_status: data.billing_status ?? null,
      });

      return jsonResponse(200, { data: (await enrichDistricts(context, [data as DistrictRow]))[0] });
    }

    if (action === "get_district_details") {
      const next = payload;
      const id = requireUuid(next.id);

      const { data: district, error: districtError } = await adminClient
        .from("districts")
        .select("id, name, slug, support_email, contact_name, is_active, created_at, subscription_plan, billing_status, renewal_date, billing_email, invoice_reference")
        .eq("id", id)
        .single();

      if (districtError || !district) {
        if (isMissingDistrictsTable(districtError as PgError)) {
          return jsonResponse(400, {
            error: "District foundation is not enabled yet. Run the latest database migration.",
          });
        }
        return jsonResponse(404, { error: "District not found." });
      }

      const tenantRowsResult = await adminClient
        .from("tenants")
        .select("id, name, access_code, status, created_at, district_id, primary_admin_profile_id")
        .eq("district_id", id)
        .order("created_at", { ascending: false });

      if (tenantRowsResult.error && !isMissingDistrictIdColumn(tenantRowsResult.error as PgError)) {
        return jsonResponse(400, { error: "Unable to load district tenants." });
      }

      const tenants = await enrichTenants(context,(tenantRowsResult.data ?? []) as TenantRow[]);
      const tenantIds = tenants.map((tenant) => tenant.id);
      const profileIds = Array.from(
        new Set(
          tenants
            .map((tenant) => tenant.primary_admin_profile_id)
            .filter((value): value is string => !!value)
        )
      );

      let emailById = new Map<string, string | null>();
      if (profileIds.length) {
        const { data: profileRows } = await adminClient
          .from("profiles")
          .select("id, auth_email")
          .in("id", profileIds);
        emailById = new Map(
          ((profileRows ?? []) as Array<{ id: string; auth_email: string | null }>).map((row) => [
            row.id,
            row.auth_email,
          ])
        );
      }

      const { data: metricRows } = tenantIds.length
        ? await adminClient
            .from("super_reporting_tenant_metrics")
            .select(
              "tenant_id, gear_total, students_total, active_checkouts, overdue_items, transactions_7d"
            )
            .in("tenant_id", tenantIds)
        : { data: [] as Array<Record<string, number | string>> };

      const tenantMetrics = ((metricRows ?? []) as Array<Record<string, number | string>>).map(
        (row) => ({
          tenant_id: String(row.tenant_id ?? ""),
          tenant_name:
            tenants.find((tenant) => tenant.id === String(row.tenant_id ?? ""))?.name ??
            String(row.tenant_name ?? "Unknown tenant"),
          gear_total: Number(row.gear_total ?? 0),
          students_total: Number(row.students_total ?? 0),
          active_checkouts: Number(row.active_checkouts ?? 0),
          overdue_items: Number(row.overdue_items ?? 0),
          transactions_7d: Number(row.transactions_7d ?? 0),
        })
      );

      const usage = tenantMetrics.reduce(
        (acc, item) => ({
          gear_total: acc.gear_total + Number(item.gear_total ?? 0),
          students_total: acc.students_total + Number(item.students_total ?? 0),
          active_checkouts: acc.active_checkouts + Number(item.active_checkouts ?? 0),
          overdue_items: acc.overdue_items + Number(item.overdue_items ?? 0),
          transactions_7d: acc.transactions_7d + Number(item.transactions_7d ?? 0),
        }),
        {
          gear_total: 0,
          students_total: 0,
          active_checkouts: 0,
          overdue_items: 0,
          transactions_7d: 0,
        }
      );

      const { data: supportRequestRows } = await adminClient
        .from("district_support_requests")
        .select("id, requester_email, requester_name, subject, message, priority, status, created_at")
        .eq("district_id", id)
        .order("created_at", { ascending: false })
        .limit(50);

      const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentLogs } = tenantIds.length
        ? await adminClient
            .from("gear_logs")
            .select("tenant_id, gear_id, checked_out_by, action_type, action_time")
            .in("tenant_id", tenantIds)
            .in("action_type", ["checkout", "return"])
            .gte("action_time", since24hIso)
            .order("action_time", { ascending: false })
            .limit(400)
        : { data: [] as Array<Record<string, string | null>> };

      const traffic = {
        checkout_24h: (recentLogs ?? []).filter((row) => row.action_type === "checkout").length,
        return_24h: (recentLogs ?? []).filter((row) => row.action_type === "return").length,
        active_tenants_24h: new Set((recentLogs ?? []).map((row) => row.tenant_id).filter(Boolean)).size,
        events_24h: (recentLogs ?? []).length,
      };

      const trafficHourKeys = Array.from({ length: 24 }, (_, offset) => {
        const date = new Date(Date.now() - (23 - offset) * 60 * 60 * 1000);
        date.setMinutes(0, 0, 0);
        return date.toISOString();
      });
      const trafficByHourMap = new Map(
        trafficHourKeys.map((iso) => [iso, { hour: iso, checkout: 0, return: 0 }])
      );
      for (const log of recentLogs ?? []) {
        const hourDate = new Date(String(log.action_time ?? ""));
        hourDate.setMinutes(0, 0, 0);
        const bucket = trafficByHourMap.get(hourDate.toISOString());
        if (!bucket) continue;
        if (log.action_type === "checkout") bucket.checkout += 1;
        if (log.action_type === "return") bucket.return += 1;
      }

      const gearIds = Array.from(
        new Set((recentLogs ?? []).map((row) => row.gear_id).filter((value): value is string => !!value))
      );
      const studentIds = Array.from(
        new Set((recentLogs ?? []).map((row) => row.checked_out_by).filter((value): value is string => !!value))
      );
      const [gearRows, studentRows] = await Promise.all([
        gearIds.length
          ? adminClient.from("gear").select("id, name, barcode").in("id", gearIds)
          : Promise.resolve({ data: [], error: null }),
        studentIds.length
          ? adminClient.from("students").select("id, username, student_id").in("id", studentIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const gearById = new Map(
        ((gearRows.data ?? []) as Array<{ id: string; name: string | null; barcode: string | null }>).map(
          (row) => [row.id, row]
        )
      );
      const studentById = new Map(
        ((studentRows.data ?? []) as Array<{ id: string; username: string | null; student_id: string | null }>).map(
          (row) => [row.id, row]
        )
      );
      const recentEvents = (recentLogs ?? []).slice(0, 20).map((row) => ({
        tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : null,
        tenant_name:
          tenants.find((tenant) => tenant.id === row.tenant_id)?.name ?? "Unknown tenant",
        action_type: row.action_type as "checkout" | "return",
        action_time: String(row.action_time ?? ""),
        gear_name:
          typeof row.gear_id === "string" ? gearById.get(row.gear_id)?.name ?? null : null,
        gear_barcode:
          typeof row.gear_id === "string" ? gearById.get(row.gear_id)?.barcode ?? null : null,
        student_username:
          typeof row.checked_out_by === "string"
            ? studentById.get(row.checked_out_by)?.username ?? null
            : null,
        student_id:
          typeof row.checked_out_by === "string"
            ? studentById.get(row.checked_out_by)?.student_id ?? null
            : null,
      }));

      const needsAttention = [
        ...(usage.overdue_items > 0
          ? [
              {
                key: "district_overdue_items",
                level: "high" as const,
                title: "Overdue items need follow-up",
                count: usage.overdue_items,
              },
            ]
          : []),
        ...(tenantMetrics.filter((item) => item.active_checkouts > 0).length > 0
          ? [
              {
                key: "district_active_checkout_tenants",
                level: "medium" as const,
                title: "Tenants with active checkouts",
                count: tenantMetrics.filter((item) => item.active_checkouts > 0).length,
              },
            ]
          : []),
        ...((supportRequestRows ?? []).filter((row) => row.status === "open").length > 0
          ? [
              {
                key: "district_open_support_requests",
                level: "low" as const,
                title: "Open support requests",
                count: (supportRequestRows ?? []).filter((row) => row.status === "open").length,
              },
            ]
          : []),
      ];

      return jsonResponse(200, {
        data: {
          district: (await enrichDistricts(context, [district as DistrictRow]))[0],
          tenants: tenants.map((tenant) => ({
            ...tenant,
            primary_admin_email: tenant.primary_admin_profile_id
              ? emailById.get(tenant.primary_admin_profile_id) ?? null
              : null,
          })),
          support_requests: supportRequestRows ?? [],
          tenant_metrics: tenantMetrics.sort((a, b) => b.transactions_7d - a.transactions_7d),
          traffic,
          traffic_by_hour: Array.from(trafficByHourMap.values()),
          recent_events: recentEvents,
          needs_attention: needsAttention,
          usage,
        },
      });
    }


  return jsonResponse(400, { error: "Invalid action" });
};
