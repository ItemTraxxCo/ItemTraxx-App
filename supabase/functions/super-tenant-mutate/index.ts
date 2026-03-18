import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

type TenantRow = {
  id: string;
  name: string;
  access_code: string;
  status?: "active" | "suspended" | "archived";
  created_at: string;
  district_id?: string | null;
  district_name?: string | null;
  district_slug?: string | null;
  primary_admin_profile_id?: string | null;
};

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

type DistrictRow = {
  id: string;
  name: string;
  slug: string;
  support_email?: string | null;
  contact_name?: string | null;
  is_active?: boolean;
  created_at?: string;
  subscription_plan?:
    | "district_core"
    | "district_growth"
    | "district_enterprise"
    | "organization_starter"
    | "organization_scale"
    | "organization_enterprise"
    | null;
  billing_status?: "draft" | "active" | "past_due" | "canceled" | null;
  renewal_date?: string | null;
  billing_email?: string | null;
  invoice_reference?: string | null;
};

type TenantMetricRow = {
  tenant_id: string;
  tenant_name: string;
  gear_total: number;
  students_total: number;
  active_checkouts: number;
  overdue_items: number;
  transactions_7d: number;
};

type PgError = {
  code?: string;
  message?: string;
};

const isMissingStatusColumn = (error: PgError | null | undefined) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes("status");

const isMissingPrimaryAdminColumn = (error: PgError | null | undefined) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes("primary_admin_profile_id");

const isMissingIsActiveColumn = (error: PgError | null | undefined) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes("is_active");

const isMissingDistrictIdColumn = (error: PgError | null | undefined) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes("district_id");

const isMissingFeatureFlagsColumn = (error: PgError | null | undefined) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes("feature_flags");

const isMissingDistrictsTable = (error: PgError | null | undefined) =>
  !!error &&
  error.code === "42P01" &&
  (error.message ?? "").toLowerCase().includes("districts");

const describeDistrictWriteError = (
  fallback: string,
  error: PgError | null | undefined
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

const lower = (value: string | null | undefined) => (value ?? "").toLowerCase();

const normalizeDistrictSlug = (value: string | null | undefined) =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const normalizeDistrictName = (value: string | null | undefined) => (value ?? "").trim();
const normalizeOptionalText = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed.length ? trimmed : null;
};
const isValidDistrictPlan = (
  value: unknown
):
  value is
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
const isValidDistrictBillingStatus = (
  value: unknown
): value is "draft" | "active" | "past_due" | "canceled" =>
  value === "draft" || value === "active" || value === "past_due" || value === "canceled";

const defaultFeatureFlags = () => ({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_student_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const hasOrigin = !!origin;
  const originAllowed =
    !hasOrigin || (hasOrigin && allowedOrigins.includes(origin as string));

  const headers =
    hasOrigin && originAllowed
      ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...baseCorsHeaders };

  return { hasOrigin, originAllowed, headers };
};

const resolveResetRedirectTo = (req: Request) => {
  const configured = (Deno.env.get("ITX_PASSWORD_RESET_REDIRECT_URL") ?? "").trim();
  if (configured) return configured;
  const origin = (req.headers.get("origin") ?? "").trim();
  if (!origin) return undefined;
  return `${origin.replace(/\/+$/, "")}/login`;
};

const isValidStatus = (value: unknown): value is "active" | "suspended" | "archived" =>
  value === "active" || value === "suspended" || value === "archived";

const isValidTenantAccountCategory = (
  value: unknown
): value is "organization" | "district" | "individual" =>
  value === "organization" || value === "district" || value === "individual";

const isValidTenantPlanCode = (
  value: unknown
): value is
  | "core"
  | "growth"
  | "starter"
  | "scale"
  | "enterprise"
  | "individual_yearly"
  | "individual_monthly" =>
  value === "core" ||
  value === "growth" ||
  value === "starter" ||
  value === "scale" ||
  value === "enterprise" ||
  value === "individual_yearly" ||
  value === "individual_monthly";

const verifySuperPassword = async (
  supabaseUrl: string,
  publishableKey: string,
  email: string,
  password: string
) => {
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
  });
  const { error } = await authClient.auth.signInWithPassword({ email, password });
  return !error;
};

const ensureDistrict = async (
  adminClient: ReturnType<typeof createClient>,
  districtSlug: string,
  districtName: string
) => {
  const slug = normalizeDistrictSlug(districtSlug);
  const name = normalizeDistrictName(districtName);
  if (!slug) {
    return { districtId: null, error: "District slug is required." };
  }
  if (!name) {
    return { districtId: null, error: "District name is required when assigning a district." };
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
        error: "District foundation is not enabled yet. Run the latest database migration.",
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
    .insert({
      name,
      slug,
    })
    .select("id")
    .single();

  if (createError || !created?.id) {
    return { districtId: null, error: "Unable to create district." };
  }

  return { districtId: created.id, error: null };
};

const enrichDistricts = async (
  adminClient: ReturnType<typeof createClient>,
  rows: DistrictRow[]
) => {
  if (!rows.length) return [];

  const districtIds = rows.map((row) => row.id);
  const { data: tenantCounts, error: tenantCountsError } = await adminClient
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

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);

  const jsonResponse = (
    status: number,
    body: Record<string, unknown> & { ok?: boolean }
  ) =>
    new Response(JSON.stringify({ ok: status < 400, ...body }), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    if (!originAllowed) {
      return new Response("Origin not allowed", { status: 403, headers });
    }
    return new Response("ok", { headers });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");

    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role, auth_email")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "super_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: rateLimit, error: rateLimitError } = await adminClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "super_admin",
        p_limit: 20,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      console.warn("super-tenant-mutate rate limit unavailable", {
        message: rateLimitError.message,
        code: (rateLimitError as { code?: string }).code,
      });
    } else {
      const rateLimitResult = rateLimit as RateLimitResult;
      if (!rateLimitResult.allowed) {
        return jsonResponse(429, {
          error: "Rate limit exceeded, please try again in a minute.",
        });
      }
    }

    const { action, payload } = await req.json();
    if (typeof action !== "string" || typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const writeAudit = async (
      actionType: string,
      targetType: string,
      targetId: string | null,
      metadata: Record<string, unknown>
    ) => {
      await adminClient.from("super_admin_audit_logs").insert({
        actor_id: user.id,
        actor_email: profile.auth_email ?? user.email ?? null,
        action_type: actionType,
        target_type: targetType,
        target_id: targetId,
        metadata,
      });
    };

    const enrichTenants = async (rows: TenantRow[]) => {
      if (!rows.length) return [];
      const tenantIds = Array.from(new Set(rows.map((row) => row.id)));
      const ids = Array.from(
        new Set(
          rows
            .map((row) => row.primary_admin_profile_id)
            .filter((value): value is string => !!value)
        )
      );
      const districtIds = Array.from(
        new Set(
          rows.map((row) => row.district_id).filter((value): value is string => !!value)
        )
      );
      const [profileRowsResult, rawPolicyRowsResult, districtRowsResult] = await Promise.all([
        ids.length
          ? adminClient.from("profiles").select("id, auth_email").in("id", ids)
          : Promise.resolve({ data: [], error: null }),
        adminClient
          .from("tenant_policies")
          .select("tenant_id, checkout_due_hours, account_category, plan_code, feature_flags")
          .in("tenant_id", tenantIds),
        districtIds.length
          ? adminClient.from("districts").select("id, name, slug").in("id", districtIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      let policyRowsResult = rawPolicyRowsResult;
      if (isMissingFeatureFlagsColumn(rawPolicyRowsResult.error as PgError)) {
        const fallbackPolicyRowsResult = await adminClient
          .from("tenant_policies")
          .select("tenant_id, checkout_due_hours, account_category, plan_code")
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
        ).map((item) => [item.id, item.auth_email])
      );
      const policyByTenant = new Map(
        ((policyRowsResult.data ?? []) as TenantPolicyRow[]).map((item) => [
          item.tenant_id,
          item,
        ])
      );
      const districtById = new Map(
        ((districtRowsResult.data ?? []) as DistrictRow[]).map((item) => [item.id, item])
      );

      return rows.map((row) => ({
        ...row,
        status: row.status ?? "active",
        district_name: row.district_id ? districtById.get(row.district_id)?.name ?? null : null,
        district_slug: row.district_id ? districtById.get(row.district_id)?.slug ?? null : null,
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

    if (action === "list_tenants") {
      const search =
        typeof (payload as Record<string, unknown>).search === "string"
          ? ((payload as Record<string, unknown>).search as string).trim()
          : "";
      const status =
        typeof (payload as Record<string, unknown>).status === "string"
          ? ((payload as Record<string, unknown>).status as string).trim()
          : "all";

      let query = adminClient
        .from("tenants")
        .select("id, name, access_code, status, created_at, district_id, primary_admin_profile_id")
        .order("created_at", { ascending: false })
        .limit(300);

      if (status !== "all" && isValidStatus(status)) {
        query = query.eq("status", status);
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

        let fallbackQuery = adminClient
          .from("tenants")
          .select("id, name, access_code, created_at")
          .order("created_at", { ascending: false })
          .limit(300);

        const { data: fallbackData, error: fallbackError } = await fallbackQuery;
        if (fallbackError) {
          return jsonResponse(400, { error: "Unable to load tenants." });
        }

        const normalized = ((fallbackData ?? []) as Array<TenantRow>).map((row) => ({
          ...row,
          status: "active",
          district_id: null,
          primary_admin_profile_id: null,
        }));

        const enriched = await enrichTenants(normalized);
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
              typeof row.district_name === "string" ? row.district_name.toLowerCase() : "";
            const districtSlug =
              typeof row.district_slug === "string" ? row.district_slug.toLowerCase() : "";
            return (
              name.includes(normalizedSearch) ||
              code.includes(normalizedSearch) ||
              districtName.includes(normalizedSearch) ||
              districtSlug.includes(normalizedSearch)
            );
          }),
        });
      }

      const enriched = await enrichTenants((data ?? []) as TenantRow[]);
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
            typeof row.district_name === "string" ? row.district_name.toLowerCase() : "";
          const districtSlug =
            typeof row.district_slug === "string" ? row.district_slug.toLowerCase() : "";
          return (
            name.includes(normalizedSearch) ||
            code.includes(normalizedSearch) ||
            districtName.includes(normalizedSearch) ||
            districtSlug.includes(normalizedSearch)
          );
        }),
      });
    }

    if (action === "list_districts") {
      const search =
        typeof (payload as Record<string, unknown>).search === "string"
          ? ((payload as Record<string, unknown>).search as string).trim().toLowerCase()
          : "";

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

      const enriched = await enrichDistricts(adminClient, (data ?? []) as DistrictRow[]);
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
      const next = payload as Record<string, unknown>;
      const name = typeof next.name === "string" ? normalizeDistrictName(next.name) : "";
      const slug = typeof next.slug === "string" ? normalizeDistrictSlug(next.slug) : "";
      const supportEmail =
        typeof next.support_email === "string" ? next.support_email.trim().toLowerCase() : "";
      const contactName =
        typeof next.contact_name === "string" ? normalizeDistrictName(next.contact_name) : "";
      const subscriptionPlan = next.subscription_plan;
      const billingStatus = next.billing_status;
      const renewalDate =
        typeof next.renewal_date === "string" ? normalizeOptionalText(next.renewal_date) : null;
      const billingEmail =
        typeof next.billing_email === "string"
          ? normalizeOptionalText(next.billing_email)?.toLowerCase() ?? null
          : null;
      const invoiceReference =
        typeof next.invoice_reference === "string"
          ? normalizeOptionalText(next.invoice_reference)
          : null;

      if (!name || !slug) {
        return jsonResponse(400, { error: "District name and slug are required." });
      }
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

      return jsonResponse(200, { data: (await enrichDistricts(adminClient, [data as DistrictRow]))[0] });
    }

    if (action === "update_district") {
      const next = payload as Record<string, unknown>;
      const id = typeof next.id === "string" ? next.id.trim() : "";
      const name = typeof next.name === "string" ? normalizeDistrictName(next.name) : "";
      const slug = typeof next.slug === "string" ? normalizeDistrictSlug(next.slug) : "";
      const supportEmail =
        typeof next.support_email === "string" ? next.support_email.trim().toLowerCase() : "";
      const contactName =
        typeof next.contact_name === "string" ? normalizeDistrictName(next.contact_name) : "";
      const isActive = next.is_active !== false;
      const subscriptionPlan = next.subscription_plan;
      const billingStatus = next.billing_status;
      const renewalDate =
        typeof next.renewal_date === "string" ? normalizeOptionalText(next.renewal_date) : null;
      const billingEmail =
        typeof next.billing_email === "string"
          ? normalizeOptionalText(next.billing_email)?.toLowerCase() ?? null
          : null;
      const invoiceReference =
        typeof next.invoice_reference === "string"
          ? normalizeOptionalText(next.invoice_reference)
          : null;

      if (!id || !name || !slug) {
        return jsonResponse(400, { error: "District id, name, and slug are required." });
      }
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

      return jsonResponse(200, { data: (await enrichDistricts(adminClient, [data as DistrictRow]))[0] });
    }

    if (action === "get_district_details") {
      const next = payload as Record<string, unknown>;
      const id = typeof next.id === "string" ? next.id.trim() : "";
      if (!id) {
        return jsonResponse(400, { error: "District id is required." });
      }

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

      const tenants = await enrichTenants((tenantRowsResult.data ?? []) as TenantRow[]);
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
        : { data: [] as Array<Record<string, number | string>>, error: null };

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
        : { data: [] as Array<Record<string, string | null>>, error: null };

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
          district: (await enrichDistricts(adminClient, [district as DistrictRow]))[0],
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

    if (action === "create_tenant") {
      const next = payload as Record<string, unknown>;
      const name = typeof next.name === "string" ? next.name.trim() : "";
      const accessCode =
        typeof next.access_code === "string" ? next.access_code.trim() : "";
      const authEmail =
        typeof next.auth_email === "string" ? next.auth_email.trim().toLowerCase() : "";
      const password = typeof next.password === "string" ? next.password : "";
      const status = next.status;
      const accountCategory = isValidTenantAccountCategory(next.account_category)
        ? next.account_category
        : "organization";
      const planCode = isValidTenantPlanCode(next.plan_code) ? next.plan_code : null;
      const districtSlug =
        typeof next.district_slug === "string" ? normalizeDistrictSlug(next.district_slug) : "";
      const districtName =
        typeof next.district_name === "string" ? normalizeDistrictName(next.district_name) : "";

      if (
        !name ||
        name.length > 120 ||
        !accessCode ||
        accessCode.length > 64 ||
        !authEmail ||
        authEmail.length > 320 ||
        password.length < 8 ||
        !isValidStatus(status)
      ) {
        return jsonResponse(400, { error: "Invalid request" });
      }
      if ((districtSlug && !districtName) || (!districtSlug && districtName)) {
        return jsonResponse(400, {
          error: "District name and slug must both be provided when assigning a district.",
        });
      }
      if (
        (accountCategory === "individual" &&
          !(!planCode || planCode === "individual_yearly" || planCode === "individual_monthly")) ||
        (accountCategory === "district" &&
          !(!planCode || planCode === "core" || planCode === "growth" || planCode === "enterprise")) ||
        (accountCategory === "organization" &&
          !(!planCode || planCode === "starter" || planCode === "scale" || planCode === "enterprise"))
      ) {
        return jsonResponse(400, { error: "Invalid plan for tenant account category." });
      }
      if (accountCategory === "individual" && (districtSlug || districtName)) {
        return jsonResponse(400, { error: "Individual accounts cannot be assigned to a district." });
      }

      let districtId: string | null = null;
      if (districtSlug && districtName) {
        const districtResult = await ensureDistrict(adminClient, districtSlug, districtName);
        if (districtResult.error) {
          return jsonResponse(400, { error: districtResult.error });
        }
        districtId = districtResult.districtId;
      }

      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("auth_email", authEmail)
        .maybeSingle();
      if (existingProfile?.id) {
        return jsonResponse(409, {
          error:
            "This email is already in use. Use a different email for this tenant admin account.",
        });
      }

      const { data, error } = await adminClient
        .from("tenants")
        .insert({ name, access_code: accessCode, status, district_id: districtId })
        .select("id, name, access_code, status, created_at, district_id, primary_admin_profile_id")
        .single();

      if (error || !data) {
        if (
          !isMissingStatusColumn(error as PgError) &&
          !isMissingDistrictIdColumn(error as PgError)
        ) {
          return jsonResponse(400, { error: "Unable to create tenant." });
        }

        const { data: fallbackData, error: fallbackError } = await adminClient
          .from("tenants")
          .insert({ name, access_code: accessCode })
          .select("id, name, access_code, created_at")
          .single();

        if (fallbackError || !fallbackData) {
          return jsonResponse(400, { error: "Unable to create tenant." });
        }

        const fallbackResponse = {
          ...fallbackData,
          status: "active",
          district_id: null,
          primary_admin_profile_id: null,
        } as TenantRow;

        return jsonResponse(200, {
          data: (await enrichTenants([fallbackResponse]))[0],
          warning:
            "Tenant created in legacy mode. Run latest migration to enable full status and primary admin fields.",
        });
      }

      const createAuthUser = await adminClient.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
      });
      if (createAuthUser.error || !createAuthUser.data.user?.id) {
        await adminClient.from("tenants").delete().eq("id", data.id);
        const message = lower(createAuthUser.error?.message);
        if (
          message.includes("already") ||
          message.includes("registered") ||
          message.includes("exists")
        ) {
          return jsonResponse(409, {
            error:
              "This email is already registered. Use a different email for the tenant admin login.",
          });
        }
        if (message.includes("password")) {
          return jsonResponse(400, {
            error:
              "Password does not meet requirements. Use a stronger password and try again.",
          });
        }
        return jsonResponse(400, {
          error: createAuthUser.error?.message || "Unable to create auth user.",
        });
      }

      const userId = createAuthUser.data.user.id;
      let createdProfileId: string | null = null;

      const insertWithIsActive = await adminClient
        .from("profiles")
        .insert({
          id: userId,
          tenant_id: data.id,
          auth_email: authEmail,
          role: "tenant_admin",
          is_active: true,
        })
        .select("id")
        .single();

      if (insertWithIsActive.error) {
        if (!isMissingIsActiveColumn(insertWithIsActive.error as PgError)) {
          await adminClient.auth.admin.deleteUser(userId);
          await adminClient.from("tenants").delete().eq("id", data.id);
          return jsonResponse(400, { error: "Unable to create tenant admin profile." });
        }

        const insertLegacyProfile = await adminClient
          .from("profiles")
          .insert({
            id: userId,
            tenant_id: data.id,
            auth_email: authEmail,
            role: "tenant_admin",
          })
          .select("id")
          .single();

        if (insertLegacyProfile.error) {
          await adminClient.auth.admin.deleteUser(userId);
          await adminClient.from("tenants").delete().eq("id", data.id);
          return jsonResponse(400, { error: "Unable to create tenant admin profile." });
        }

        createdProfileId = insertLegacyProfile.data.id;
      } else {
        createdProfileId = insertWithIsActive.data.id;
      }

      if (createdProfileId) {
        const updateTenantPrimary = await adminClient
          .from("tenants")
          .update({ primary_admin_profile_id: createdProfileId })
          .eq("id", data.id);

        if (updateTenantPrimary.error && !isMissingPrimaryAdminColumn(updateTenantPrimary.error as PgError)) {
          await adminClient.auth.admin.deleteUser(userId);
          await adminClient.from("profiles").delete().eq("id", createdProfileId);
          await adminClient.from("tenants").delete().eq("id", data.id);
          return jsonResponse(400, { error: "Unable to set tenant primary admin." });
        }
      }

      let tenantPolicyResult = await adminClient
        .from("tenant_policies")
        .upsert(
          {
            tenant_id: data.id,
            checkout_due_hours: 72,
            account_category: accountCategory,
            plan_code: planCode,
            feature_flags: defaultFeatureFlags(),
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id" }
        );

      if (isMissingFeatureFlagsColumn(tenantPolicyResult.error as PgError)) {
        tenantPolicyResult = await adminClient
          .from("tenant_policies")
          .upsert(
            {
              tenant_id: data.id,
              checkout_due_hours: 72,
              account_category: accountCategory,
              plan_code: planCode,
              updated_by: user.id,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "tenant_id" }
          );
      }

      if (tenantPolicyResult.error) {
        await adminClient.auth.admin.deleteUser(userId);
        if (createdProfileId) {
          await adminClient.from("profiles").delete().eq("id", createdProfileId);
        }
        await adminClient.from("tenants").delete().eq("id", data.id);
        return jsonResponse(400, { error: "Unable to create tenant policy." });
      }

      await writeAudit("create_tenant", "tenant", data.id, {
        tenant_name: data.name,
        status: data.status,
        account_category: accountCategory,
        plan_code: planCode,
        district_slug: districtSlug || null,
        tenant_admin_email: authEmail,
      });

      const { data: finalTenant } = await adminClient
        .from("tenants")
        .select("id, name, access_code, status, created_at, district_id, primary_admin_profile_id")
        .eq("id", data.id)
        .single();

      return jsonResponse(200, {
        data: (await enrichTenants([((finalTenant ?? data) as TenantRow)]))[0],
      });
    }

    if (action === "update_tenant") {
      const next = payload as Record<string, unknown>;
      const id = typeof next.id === "string" ? next.id.trim() : "";
      const name = typeof next.name === "string" ? next.name.trim() : "";
      const accessCode =
        typeof next.access_code === "string" ? next.access_code.trim() : "";
      const accountCategory = isValidTenantAccountCategory(next.account_category)
        ? next.account_category
        : "organization";
      const planCode = isValidTenantPlanCode(next.plan_code) ? next.plan_code : null;
      const districtSlug =
        typeof next.district_slug === "string" ? normalizeDistrictSlug(next.district_slug) : "";
      const districtName =
        typeof next.district_name === "string" ? normalizeDistrictName(next.district_name) : "";

      if (!id || !name || name.length > 120 || !accessCode || accessCode.length > 64) {
        return jsonResponse(400, { error: "Invalid request" });
      }
      if ((districtSlug && !districtName) || (!districtSlug && districtName)) {
        return jsonResponse(400, {
          error: "District name and slug must both be provided when assigning a district.",
        });
      }
      if (
        (accountCategory === "individual" &&
          !(!planCode || planCode === "individual_yearly" || planCode === "individual_monthly")) ||
        (accountCategory === "district" &&
          !(!planCode || planCode === "core" || planCode === "growth" || planCode === "enterprise")) ||
        (accountCategory === "organization" &&
          !(!planCode || planCode === "starter" || planCode === "scale" || planCode === "enterprise"))
      ) {
        return jsonResponse(400, { error: "Invalid plan for tenant account category." });
      }
      if (accountCategory === "individual" && (districtSlug || districtName)) {
        return jsonResponse(400, { error: "Individual accounts cannot be assigned to a district." });
      }

      let districtId: string | null = null;
      if (districtSlug && districtName) {
        const districtResult = await ensureDistrict(adminClient, districtSlug, districtName);
        if (districtResult.error) {
          return jsonResponse(400, { error: districtResult.error });
        }
        districtId = districtResult.districtId;
      }

      const { data, error } = await adminClient
        .from("tenants")
        .update({ name, access_code: accessCode, district_id: districtId })
        .eq("id", id)
        .select("id, name, access_code, status, created_at, district_id, primary_admin_profile_id")
        .single();

      if (error || !data) {
        if (isMissingDistrictIdColumn(error as PgError)) {
          return jsonResponse(400, {
            error: "District foundation is not enabled yet. Run the latest database migration.",
          });
        }
        return jsonResponse(400, { error: "Unable to update tenant." });
      }

      const { error: policyError } = await adminClient
        .from("tenant_policies")
        .upsert(
          {
            tenant_id: id,
            account_category: accountCategory,
            plan_code: planCode,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id" }
        );

      if (policyError) {
        return jsonResponse(400, { error: "Unable to update tenant plan details." });
      }

      await writeAudit("update_tenant", "tenant", data.id, {
        tenant_name: data.name,
        account_category: accountCategory,
        plan_code: planCode,
        district_slug: districtSlug || null,
      });

      return jsonResponse(200, { data: (await enrichTenants([data as TenantRow]))[0] });
    }

    if (action === "set_tenant_status") {
      const next = payload as Record<string, unknown>;
      const id = typeof next.id === "string" ? next.id.trim() : "";
      const status = next.status;
      const superPassword =
        typeof next.super_password === "string" ? next.super_password : "";
      const confirmPhrase =
        typeof next.confirm_phrase === "string" ? next.confirm_phrase.trim() : "";

      if (!id || !isValidStatus(status)) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      if (!superPassword) {
        return jsonResponse(400, { error: "Super password is required." });
      }
      if (confirmPhrase !== "CONFIRM") {
        return jsonResponse(400, { error: "Confirmation phrase mismatch." });
      }

      const verified = await verifySuperPassword(
        supabaseUrl,
        publishableKey,
        profile.auth_email ?? user.email ?? "",
        superPassword
      );
      if (!verified) {
        return jsonResponse(403, { error: "Super password verification failed." });
      }

      const { data, error } = await adminClient
        .from("tenants")
        .update({ status })
        .eq("id", id)
        .select("id, name, access_code, status, created_at, district_id, primary_admin_profile_id")
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
        { tenant_name: data.name, status: data.status }
      );

      return jsonResponse(200, { data: (await enrichTenants([data as TenantRow]))[0] });
    }

    if (action === "send_primary_admin_reset") {
      const next = payload as Record<string, unknown>;
      const tenantId = typeof next.tenant_id === "string" ? next.tenant_id.trim() : "";
      if (!tenantId) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data: tenant, error: tenantError } = await adminClient
        .from("tenants")
        .select("id, primary_admin_profile_id")
        .eq("id", tenantId)
        .single();

      if (tenantError || !tenant?.id) {
        return jsonResponse(400, { error: "Invalid tenant." });
      }

      if (!tenant.primary_admin_profile_id) {
        return jsonResponse(400, {
          error: "No primary admin is set for this tenant.",
        });
      }

      const { data: primaryProfile, error: primaryError } = await adminClient
        .from("profiles")
        .select("auth_email")
        .eq("id", tenant.primary_admin_profile_id)
        .single();

      const authEmail = primaryProfile?.auth_email?.trim();
      if (primaryError || !authEmail) {
        return jsonResponse(400, { error: "Primary admin email not found." });
      }

      const redirectTo = resolveResetRedirectTo(req);
      const { error: resetError } = await adminClient.auth.resetPasswordForEmail(
        authEmail,
        redirectTo ? { redirectTo } : undefined
      );
      if (resetError) {
        return jsonResponse(400, {
          error: `Unable to send password reset. ${resetError.message}`,
        });
      }

      await writeAudit("send_primary_admin_reset", "tenant", tenant.id, {
        auth_email: authEmail,
      });

      return jsonResponse(200, { data: { success: true, auth_email: authEmail } });
    }

    if (action === "set_primary_admin") {
      const next = payload as Record<string, unknown>;
      const tenantId = typeof next.tenant_id === "string" ? next.tenant_id.trim() : "";
      const profileId = typeof next.profile_id === "string" ? next.profile_id.trim() : "";

      if (!tenantId || !profileId) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data: targetProfile, error: profileError } = await adminClient
        .from("profiles")
        .select("id, tenant_id, role, auth_email")
        .eq("id", profileId)
        .single();

      if (
        profileError ||
        !targetProfile?.id ||
        targetProfile.tenant_id !== tenantId ||
        targetProfile.role !== "tenant_admin"
      ) {
        return jsonResponse(400, { error: "Invalid tenant admin profile." });
      }

      const { data, error } = await adminClient
        .from("tenants")
        .update({ primary_admin_profile_id: profileId })
        .eq("id", tenantId)
        .select("id, name, access_code, status, created_at, district_id, primary_admin_profile_id")
        .single();

      if (error || !data) {
        if (isMissingPrimaryAdminColumn(error as PgError)) {
          return jsonResponse(400, {
            error:
              "Primary admin field is not enabled yet. Run the latest database migration.",
          });
        }
        return jsonResponse(400, { error: "Unable to update primary admin." });
      }

      await writeAudit("set_primary_admin", "tenant", tenantId, {
        profile_id: profileId,
        auth_email: targetProfile.auth_email ?? null,
      });

      return jsonResponse(200, { data: (await enrichTenants([data as TenantRow]))[0] });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    console.error("super-tenant-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
