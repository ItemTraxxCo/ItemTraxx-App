import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

type RpcError = {
  code?: string;
  message?: string;
};

type TenantRow = {
  id: string;
  name: string;
  access_code: string;
  status?: "active" | "suspended";
  created_at: string;
  primary_admin_profile_id?: string | null;
};

type TenantPolicyRow = {
  tenant_id: string;
  checkout_due_hours: number | null;
  feature_flags: Record<string, unknown> | null;
};

const isMissingStatusColumn = (error: RpcError | null | undefined) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes("status");

const isMissingPrimaryAdminColumn = (error: RpcError | null | undefined) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes("primary_admin_profile_id");

const isMissingIsActiveColumn = (error: RpcError | null | undefined) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes("is_active");

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

const isValidStatus = (value: unknown): value is "active" | "suspended" =>
  value === "active" || value === "suspended";

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

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "super_admin",
        p_limit: 20,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      const rpcError = rateLimitError as RpcError;
      const isLegacyUnauthorizedLimiter =
        rpcError.code === "P0001" &&
        (rpcError.message ?? "").toLowerCase().includes("unauthorized");
      if (!isLegacyUnauthorizedLimiter) {
        return jsonResponse(500, { error: "Rate limit check failed" });
      }
      console.warn(
        "super-tenant-mutate rate limit check bypassed due to legacy consume_rate_limit auth constraints"
      );
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

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

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
      const [profileRowsResult, policyRowsResult] = await Promise.all([
        ids.length
          ? adminClient.from("profiles").select("id, auth_email").in("id", ids)
          : Promise.resolve({ data: [], error: null }),
        adminClient
          .from("tenant_policies")
          .select("tenant_id, checkout_due_hours, feature_flags")
          .in("tenant_id", tenantIds),
      ]);

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

      return rows.map((row) => ({
        ...row,
        status: row.status ?? "active",
        primary_admin_email: row.primary_admin_profile_id
          ? emailById.get(row.primary_admin_profile_id) ?? null
          : null,
        checkout_due_hours:
          typeof policyByTenant.get(row.id)?.checkout_due_hours === "number"
            ? policyByTenant.get(row.id)?.checkout_due_hours
            : 72,
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
        .select("id, name, access_code, status, created_at, primary_admin_profile_id")
        .order("created_at", { ascending: false })
        .limit(300);

      if (status !== "all" && isValidStatus(status)) {
        query = query.eq("status", status);
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,access_code.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) {
        if (!isMissingStatusColumn(error as RpcError) && !isMissingPrimaryAdminColumn(error as RpcError)) {
          return jsonResponse(400, { error: "Unable to load tenants." });
        }

        let fallbackQuery = adminClient
          .from("tenants")
          .select("id, name, access_code, created_at")
          .order("created_at", { ascending: false })
          .limit(300);

        if (search) {
          fallbackQuery = fallbackQuery.or(
            `name.ilike.%${search}%,access_code.ilike.%${search}%`
          );
        }

        const { data: fallbackData, error: fallbackError } = await fallbackQuery;
        if (fallbackError) {
          return jsonResponse(400, { error: "Unable to load tenants." });
        }

        const normalized = ((fallbackData ?? []) as Array<TenantRow>).map((row) => ({
          ...row,
          status: "active",
          primary_admin_profile_id: null,
        }));

        return jsonResponse(200, { data: await enrichTenants(normalized) });
      }

      return jsonResponse(200, { data: await enrichTenants((data ?? []) as TenantRow[]) });
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
        .insert({ name, access_code: accessCode, status })
        .select("id, name, access_code, status, created_at, primary_admin_profile_id")
        .single();

      if (error || !data) {
        if (!isMissingStatusColumn(error as RpcError)) {
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
        if (!isMissingIsActiveColumn(insertWithIsActive.error as RpcError)) {
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

        if (updateTenantPrimary.error && !isMissingPrimaryAdminColumn(updateTenantPrimary.error as RpcError)) {
          await adminClient.auth.admin.deleteUser(userId);
          await adminClient.from("profiles").delete().eq("id", createdProfileId);
          await adminClient.from("tenants").delete().eq("id", data.id);
          return jsonResponse(400, { error: "Unable to set tenant primary admin." });
        }
      }

      await writeAudit("create_tenant", "tenant", data.id, {
        tenant_name: data.name,
        status: data.status,
        tenant_admin_email: authEmail,
      });

      const { data: finalTenant } = await adminClient
        .from("tenants")
        .select("id, name, access_code, status, created_at, primary_admin_profile_id")
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

      if (!id || !name || name.length > 120 || !accessCode || accessCode.length > 64) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("tenants")
        .update({ name, access_code: accessCode })
        .eq("id", id)
        .select("id, name, access_code, status, created_at, primary_admin_profile_id")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to update tenant." });
      }

      await writeAudit("update_tenant", "tenant", data.id, {
        tenant_name: data.name,
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
        .select("id, name, access_code, status, created_at, primary_admin_profile_id")
        .single();

      if (error || !data) {
        if (isMissingStatusColumn(error as RpcError)) {
          return jsonResponse(400, {
            error:
              "Tenant status is not enabled yet. Run the latest database migration.",
          });
        }
        return jsonResponse(400, { error: "Unable to update tenant status." });
      }

      await writeAudit(
        status === "suspended" ? "suspend_tenant" : "reactivate_tenant",
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
        .select("id, name, access_code, status, created_at, primary_admin_profile_id")
        .single();

      if (error || !data) {
        if (isMissingPrimaryAdminColumn(error as RpcError)) {
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
