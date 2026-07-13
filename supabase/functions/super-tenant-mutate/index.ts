import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../_shared/privilegedStepUp.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import {
  isMissingPostgrestColumn,
  isMissingPostgrestRelation,
} from "../_shared/postgrestErrors.ts";
import {
  ACCESS_CODE_PATTERN,
  asRecord,
  optionalEmail,
  optionalText,
  requireEmail,
  requireEnum,
  requireText,
  requireUuid,
  SLUG_PATTERN,
  ValidationError,
} from "../_shared/validation.ts";
import type { SuperTenantContext } from "./context.ts";
import {
  enrichTenants as enrichTenantRows,
  handleListTenants,
} from "./actions/tenantQueries.ts";
import {
  handleDistrictAction,
  isMissingDistrictIdColumn,
  isMissingDistrictsTable,
  normalizeDistrictSlug,
} from "./actions/districts.ts";

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
type SupabaseAdminClient = ReturnType<typeof createClient<any>>;

const isMissingStatusColumn = (error: PgError | null | undefined) =>
  isMissingPostgrestColumn(error, "status");

const isMissingPrimaryAdminColumn = (error: PgError | null | undefined) =>
  isMissingPostgrestColumn(error, "primary_admin_profile_id");

const isMissingIsActiveColumn = (error: PgError | null | undefined) =>
  isMissingPostgrestColumn(error, "is_active");


const isMissingNamedColumn = (
  error: PgError | null | undefined,
  column: string
) => {
  return isMissingPostgrestColumn(error, column, { allowSchemaCache: true });
};

const isMissingFeatureFlagsColumn = (error: PgError | null | undefined) =>
  isMissingNamedColumn(error, "feature_flags");

const isMissingAccountCategoryColumn = (error: PgError | null | undefined) =>
  isMissingNamedColumn(error, "account_category");

const isMissingPlanCodeColumn = (error: PgError | null | undefined) =>
  isMissingNamedColumn(error, "plan_code");

const isTenantPolicyAccountCategoryConstraintError = (
  error: PgError | null | undefined
) =>
  !!error &&
  (error.code === "23514" || error.code === "P0001") &&
  (error.message ?? "").toLowerCase().includes("tenant_policies_account_category_check");

const isTenantPolicyPlanCodeConstraintError = (error: PgError | null | undefined) =>
  !!error &&
  (error.code === "23514" || error.code === "P0001") &&
  (error.message ?? "").toLowerCase().includes("tenant_policies_plan_code_check");

const normalizeDistrictName = (value: string | null | undefined) => (value ?? "").trim();
const lower = (value: string | null | undefined) => (value ?? "").toLowerCase();
const defaultFeatureFlags = () => ({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_student_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));

  const hasOrigin = !!origin;
  const originAllowed =
    !hasOrigin || (hasOrigin && isAllowedOrigin(origin as string, allowedOrigins));

  const headers =
    hasOrigin && originAllowed
      ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...baseCorsHeaders };

  return { hasOrigin, originAllowed, headers };
};

const resolveResetRedirectTo = (req: Request) => {
  const configured = (Deno.env.get("ITX_PASSWORD_RESET_REDIRECT_URL") ?? "").trim();
  if (configured) return configured;
  console.error("super-tenant-mutate missing ITX_PASSWORD_RESET_REDIRECT_URL");
  return null;
};

const isValidStatus = (value: unknown): value is "active" | "suspended" | "archived" =>
  value === "active" || value === "suspended" || value === "archived";
const TENANT_STATUSES = new Set(["active", "suspended", "archived"] as const);
const TENANT_ACCOUNT_CATEGORIES = new Set(["organization", "district", "individual"] as const);
const TENANT_PLAN_CODES = new Set([
  "core",
  "growth",
  "starter",
  "scale",
  "enterprise",
  "individual_yearly",
  "individual_monthly",
] as const);

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
  adminClient: SupabaseAdminClient,
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

type TenantPolicyUpsertInput = {
  tenant_id: string;
  checkout_due_hours?: number;
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
  feature_flags?: Record<string, unknown> | null;
  updated_by: string;
  updated_at: string;
};

const upsertTenantPolicy = async (
  adminClient: SupabaseAdminClient,
  policy: TenantPolicyUpsertInput
) => {
  const buildPayload = (options: {
    includeAccountCategory: boolean;
    includePlanCode: boolean;
    includeFeatureFlags: boolean;
  }) => ({
    tenant_id: policy.tenant_id,
    checkout_due_hours: policy.checkout_due_hours ?? 72,
    ...(options.includeAccountCategory ? { account_category: policy.account_category ?? null } : {}),
    ...(options.includePlanCode ? { plan_code: policy.plan_code ?? null } : {}),
    ...(options.includeFeatureFlags && policy.feature_flags !== undefined
      ? { feature_flags: policy.feature_flags ?? defaultFeatureFlags() }
      : {}),
    updated_by: policy.updated_by,
    updated_at: policy.updated_at,
  });

  let includeAccountCategory = true;
  let includePlanCode = true;
  let includeFeatureFlags = true;

  for (;;) {
    const result = await adminClient.from("tenant_policies").upsert(
      buildPayload({ includeAccountCategory, includePlanCode, includeFeatureFlags }),
      { onConflict: "tenant_id" }
    );

    if (!result.error) return result;
    if (includeFeatureFlags && isMissingFeatureFlagsColumn(result.error as PgError)) {
      includeFeatureFlags = false;
      continue;
    }
    if (
      includeAccountCategory &&
      (isMissingAccountCategoryColumn(result.error as PgError) ||
        isTenantPolicyAccountCategoryConstraintError(result.error as PgError))
    ) {
      includeAccountCategory = false;
      continue;
    }
    if (
      includePlanCode &&
      (isMissingPlanCodeColumn(result.error as PgError) ||
        isTenantPolicyPlanCodeConstraintError(result.error as PgError))
    ) {
      includePlanCode = false;
      continue;
    }
    return result;
  }
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

  const ingressError = await requireTrustedEdgeIngress(req, "super-tenant-mutate", jsonResponse);
  if (ingressError) return ingressError;

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const authToken = authHeader.replace(/^Bearer\s+/i, "").trim();

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
      .select("role, auth_email, is_active")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "super_admin" || profile.is_active === false) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    try {
      const hasStepUp = await hasPrivilegedStepUp(adminClient, {
        userId: user.id,
        roleScope: "super_admin",
        authToken,
      });
      if (!hasStepUp) {
        return jsonResponse(403, { error: "Super admin verification required." });
      }
    } catch (error) {
      if (isMissingPrivilegedStepUpTable(error as { code?: string; message?: string })) {
        return jsonResponse(503, {
          error: "Privileged verification controls unavailable. Run latest SQL setup.",
        });
      }
      throw error;
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "super_admin",
        p_limit: 20,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      console.error("super-tenant-mutate rate limit unavailable", {
        message: rateLimitError.message,
        code: (rateLimitError as { code?: string }).code,
      });
      return jsonResponse(500, { error: "Rate limit check failed" });
    }

    const rateLimitResult = Array.isArray(rateLimit)
      ? ((rateLimit[0] as RateLimitResult | undefined) ?? null)
      : ((rateLimit as RateLimitResult | null) ?? null);
    if (!rateLimitResult) {
      return jsonResponse(500, { error: "Rate limit check failed" });
    }
    if (!rateLimitResult.allowed) {
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    const requestBody = asRecord(await readJsonBody(req));
    const action = requireText(requestBody.action, { maxLen: 64 });
    const payload = asRecord(requestBody.payload);

    const writeAudit = async (
      actionType: string,
      targetType: string,
      targetId: string | null,
      metadata: Record<string, unknown>
    ) => {
      const { error } = await adminClient.from("super_admin_audit_logs").insert({
        actor_id: user.id,
        actor_email: profile.auth_email ?? user.email ?? null,
        action_type: actionType,
        target_type: targetType,
        target_id: targetId,
        metadata,
      });
      if (error) throw new Error("Unable to write security audit log.");
    };

    const actionContext: SuperTenantContext = {
      req,
      action,
      payload,
      userClient,
      adminClient,
      user,
      profile,
      jsonResponse,
      writeAudit,
      resetRedirectTo:
        (Deno.env.get("ITX_PASSWORD_RESET_REDIRECT_URL") ?? "").trim() || null,
      supabaseUrl,
      publishableKey,
    };

    if (action === "list_tenants") {
      return await handleListTenants(actionContext);
    }
    const enrichTenants = (rows: TenantRow[]) =>
      enrichTenantRows(actionContext, rows);

    if (
      action === "list_districts" ||
      action === "create_district" ||
      action === "update_district" ||
      action === "get_district_details"
    ) {
      return await handleDistrictAction(actionContext);
    }
    if (action === "create_tenant") {
      const next = payload;
      const name = requireText(next.name, { maxLen: 120 });
      const accessCode = requireText(next.access_code, {
        maxLen: 64,
        pattern: ACCESS_CODE_PATTERN,
      });
      const authEmail = requireEmail(next.auth_email);
      const password = typeof next.password === "string" ? next.password : "";
      const status = requireEnum(next.status, TENANT_STATUSES);
      const accountCategory = next.account_category === undefined || next.account_category === null || next.account_category === ""
        ? "organization"
        : requireEnum(next.account_category, TENANT_ACCOUNT_CATEGORIES);
      const planCode = next.plan_code === undefined || next.plan_code === null || next.plan_code === ""
        ? null
        : requireEnum(next.plan_code, TENANT_PLAN_CODES);
      const districtSlugRaw = optionalText(next.district_slug, { maxLen: 80 });
      const districtSlug = districtSlugRaw
        ? requireText(normalizeDistrictSlug(districtSlugRaw), { maxLen: 63, pattern: SLUG_PATTERN })
        : "";
      const districtName = optionalText(next.district_name, { maxLen: 120 });

      if (password.length < 8 || password.length > 1024) {
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
          error: "Unable to create auth user.",
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

      const tenantPolicyResult = await upsertTenantPolicy(adminClient, {
        tenant_id: data.id,
        checkout_due_hours: 72,
        account_category: accountCategory,
        plan_code: planCode,
        feature_flags: defaultFeatureFlags(),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      });

      if (tenantPolicyResult.error) {
        console.error("super-tenant-mutate tenant policy create failed", {
          code: tenantPolicyResult.error.code,
          message: tenantPolicyResult.error.message,
          details: tenantPolicyResult.error.details,
          hint: tenantPolicyResult.error.hint,
          accountCategory,
          planCode,
          tenantId: data.id,
        });
        await adminClient.auth.admin.deleteUser(userId);
        if (createdProfileId) {
          await adminClient.from("profiles").delete().eq("id", createdProfileId);
        }
        await adminClient.from("tenants").delete().eq("id", data.id);
        return jsonResponse(400, {
          error: "Unable to create tenant policy.",
        });
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
      const next = payload;
      const id = requireUuid(next.id);
      const name = requireText(next.name, { maxLen: 120 });
      const accessCode = requireText(next.access_code, {
        maxLen: 64,
        pattern: ACCESS_CODE_PATTERN,
      });
      const accountCategory = next.account_category === undefined || next.account_category === null || next.account_category === ""
        ? "organization"
        : requireEnum(next.account_category, TENANT_ACCOUNT_CATEGORIES);
      const planCode = next.plan_code === undefined || next.plan_code === null || next.plan_code === ""
        ? null
        : requireEnum(next.plan_code, TENANT_PLAN_CODES);
      const districtSlugRaw = optionalText(next.district_slug, { maxLen: 80 });
      const districtSlug = districtSlugRaw
        ? requireText(normalizeDistrictSlug(districtSlugRaw), { maxLen: 63, pattern: SLUG_PATTERN })
        : "";
      const districtName = optionalText(next.district_name, { maxLen: 120 });
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

      const { error: policyError } = await upsertTenantPolicy(adminClient, {
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

      return jsonResponse(200, { data: (await enrichTenants([data as TenantRow]))[0] });
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
      const next = payload;
      const tenantId = requireUuid(next.tenant_id);

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
      if (!redirectTo) {
        return jsonResponse(500, {
          error: "Password reset redirect is not configured.",
        });
      }
      const { error: resetError } = await adminClient.auth.resetPasswordForEmail(
        authEmail,
        { redirectTo }
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
      const next = payload;
      const tenantId = requireUuid(next.tenant_id);
      const profileId = requireUuid(next.profile_id);

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
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("super-tenant-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
