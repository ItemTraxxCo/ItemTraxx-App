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

const lower = (value: string | null | undefined) => (value ?? "").toLowerCase();

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

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
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
      console.warn("super-admin-mutate rate limit unavailable", {
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

    if (action === "list_tenant_admins") {
      const search =
        typeof (payload as Record<string, unknown>).search === "string"
          ? ((payload as Record<string, unknown>).search as string).trim()
          : "";
      const tenantId =
        typeof (payload as Record<string, unknown>).tenant_id === "string"
          ? ((payload as Record<string, unknown>).tenant_id as string).trim()
          : "all";
      const districtId =
        typeof (payload as Record<string, unknown>).district_id === "string"
          ? ((payload as Record<string, unknown>).district_id as string).trim()
          : "all";
      const adminScope =
        typeof (payload as Record<string, unknown>).admin_scope === "string"
          ? ((payload as Record<string, unknown>).admin_scope as string).trim()
          : "tenant";
      const targetRole = adminScope === "district" ? "district_admin" : "tenant_admin";

      let query = adminClient
        .from("profiles")
        .select("id, tenant_id, district_id, auth_email, role, is_active, created_at")
        .eq("role", targetRole)
        .order("created_at", { ascending: false })
        .limit(300);

      if (targetRole === "tenant_admin" && tenantId && tenantId !== "all") {
        query = query.eq("tenant_id", tenantId);
      }
      if (targetRole === "district_admin" && districtId && districtId !== "all") {
        query = query.eq("district_id", districtId);
      }

      if (search) {
        query = query.ilike("auth_email", `%${search}%`);
      }

      const { data: profilesData, error: profilesError } = await query;
      if (profilesError) {
        return jsonResponse(400, { error: "Unable to load tenant admins." });
      }

      const admins = (profilesData ?? []) as Array<{
        id: string;
        tenant_id: string | null;
        district_id: string | null;
        auth_email: string | null;
        role: string;
        is_active: boolean | null;
        created_at: string;
      }>;

      const tenantIds = Array.from(
        new Set(admins.map((item) => item.tenant_id).filter(Boolean))
      ) as string[];
      const districtIds = Array.from(
        new Set(admins.map((item) => item.district_id).filter(Boolean))
      ) as string[];

      let tenantNameById = new Map<string, string>();
      let districtNameById = new Map<string, string>();
      if (tenantIds.length > 0) {
        const { data: tenantRows } = await adminClient
          .from("tenants")
          .select("id, name")
          .in("id", tenantIds);
        tenantNameById = new Map(
          ((tenantRows ?? []) as Array<{ id: string; name: string }>).map((row) => [
            row.id,
            row.name,
          ])
        );
      }
      if (districtIds.length > 0) {
        const { data: districtRows } = await adminClient
          .from("districts")
          .select("id, name")
          .in("id", districtIds);
        districtNameById = new Map(
          ((districtRows ?? []) as Array<{ id: string; name: string }>).map((row) => [
            row.id,
            row.name,
          ])
        );
      }

      const mapped = admins.map((item) => ({
        id: item.id,
        tenant_id: item.tenant_id ?? "",
        district_id: item.district_id ?? "",
        auth_email: item.auth_email ?? "",
        role: targetRole,
        is_active: item.is_active !== false,
        created_at: item.created_at,
        tenant_name: item.tenant_id ? tenantNameById.get(item.tenant_id) ?? null : null,
        district_name: item.district_id
          ? districtNameById.get(item.district_id) ?? null
          : null,
      }));

      return jsonResponse(200, { data: mapped });
    }

    if (action === "create_tenant_admin") {
      const next = payload as Record<string, unknown>;
      const tenantId = typeof next.tenant_id === "string" ? next.tenant_id.trim() : "";
      const districtId =
        typeof next.district_id === "string" ? next.district_id.trim() : "";
      const authEmail = typeof next.auth_email === "string" ? next.auth_email.trim() : "";
      const password = typeof next.password === "string" ? next.password : "";
      const adminScope =
        typeof next.admin_scope === "string" ? next.admin_scope.trim() : "tenant";
      const targetRole = adminScope === "district" ? "district_admin" : "tenant_admin";

      if (
        (!tenantId && targetRole === "tenant_admin") ||
        (!districtId && targetRole === "district_admin") ||
        !authEmail ||
        authEmail.length > 320 ||
        password.length < 8
      ) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      let targetEntityName: string | null = null;
      if (targetRole === "tenant_admin") {
        const { data: tenant, error: tenantError } = await adminClient
          .from("tenants")
          .select("id, name")
          .eq("id", tenantId)
          .single();

        if (tenantError || !tenant?.id) {
          return jsonResponse(400, { error: "Invalid tenant." });
        }
        targetEntityName = tenant.name;
      } else {
        const { data: district, error: districtError } = await adminClient
          .from("districts")
          .select("id, name")
          .eq("id", districtId)
          .single();
        if (districtError || !district?.id) {
          return jsonResponse(400, { error: "Invalid district." });
        }
        targetEntityName = district.name;
      }

      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id, role")
        .eq("auth_email", authEmail)
        .maybeSingle();

      if (existingProfile?.role === "super_admin") {
        return jsonResponse(409, {
          error:
            "This email is already used by a super admin account. Use a different email for tenant admin access.",
        });
      }
      if (existingProfile?.role === "tenant_admin" || existingProfile?.role === "district_admin") {
        return jsonResponse(409, {
          error:
            "An admin with this email already exists. Use a different email or re-enable the existing admin.",
        });
      }

      const { data: authResult, error: createUserError } = await adminClient.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
      });

      if (createUserError || !authResult.user?.id) {
        const message = lower(createUserError?.message);
        if (
          message.includes("already") ||
          message.includes("registered") ||
          message.includes("exists")
        ) {
          return jsonResponse(409, {
            error:
              "An account with this email already exists. Use a different email or disable/enable the existing admin.",
          });
        }
        if (message.includes("password")) {
          return jsonResponse(400, {
            error:
              "Password does not meet requirements. Use a stronger password and try again.",
          });
        }
        return jsonResponse(400, {
          error: createUserError?.message || "Unable to create auth user.",
        });
      }

      const userId = authResult.user.id;
      const { data: createdProfile, error: insertProfileError } = await adminClient
        .from("profiles")
        .insert({
          id: userId,
          tenant_id: targetRole === "tenant_admin" ? tenantId : null,
          district_id: targetRole === "district_admin" ? districtId : null,
          auth_email: authEmail,
          role: targetRole,
          is_active: true,
        })
        .select("id, tenant_id, district_id, auth_email, role, is_active, created_at")
        .single();

      if (insertProfileError || !createdProfile) {
        await adminClient.auth.admin.deleteUser(userId);
        const message = lower(insertProfileError?.message);
        if (message.includes("duplicate key") || message.includes("already exists")) {
          return jsonResponse(409, {
            error:
              "A tenant admin profile with this email already exists. Use a different email or update the existing admin.",
          });
        }
        return jsonResponse(400, {
          error: insertProfileError?.message || "Unable to create tenant admin profile.",
        });
      }

      await writeAudit(targetRole === "district_admin" ? "create_district_admin" : "create_tenant_admin", "profile", createdProfile.id, {
        tenant_id: createdProfile.tenant_id,
        district_id: createdProfile.district_id,
        auth_email: createdProfile.auth_email,
      });

      return jsonResponse(200, {
        data: {
          ...createdProfile,
          tenant_name: targetRole === "tenant_admin" ? targetEntityName : null,
          district_name: targetRole === "district_admin" ? targetEntityName : null,
          is_active: createdProfile.is_active !== false,
        },
      });
    }

    if (action === "set_admin_status") {
      const next = payload as Record<string, unknown>;
      const id = typeof next.id === "string" ? next.id.trim() : "";
      const isActive = next.is_active;

      if (!id || typeof isActive !== "boolean") {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const adminScope =
        typeof (payload as Record<string, unknown>).admin_scope === "string"
          ? ((payload as Record<string, unknown>).admin_scope as string).trim()
          : "tenant";
      const targetRole = adminScope === "district" ? "district_admin" : "tenant_admin";
      const { data: updated, error: updateError } = await adminClient
        .from("profiles")
        .update({ is_active: isActive })
        .eq("id", id)
        .eq("role", targetRole)
        .select("id, tenant_id, district_id, auth_email, role, is_active, created_at")
        .single();

      if (updateError || !updated) {
        return jsonResponse(400, { error: "Unable to update tenant admin status." });
      }

      let tenantName: string | null = null;
      let districtName: string | null = null;
      if (updated.tenant_id) {
        const { data: tenant } = await adminClient
          .from("tenants")
          .select("name")
          .eq("id", updated.tenant_id)
          .single();
        tenantName = tenant?.name ?? null;
      }
      if (updated.district_id) {
        const { data: district } = await adminClient
          .from("districts")
          .select("name")
          .eq("id", updated.district_id)
          .single();
        districtName = district?.name ?? null;
      }

      await writeAudit(
        isActive
          ? targetRole === "district_admin"
            ? "enable_district_admin"
            : "enable_tenant_admin"
          : targetRole === "district_admin"
            ? "disable_district_admin"
            : "disable_tenant_admin",
        "profile",
        updated.id,
        { auth_email: updated.auth_email }
      );

      return jsonResponse(200, {
        data: {
          ...updated,
          is_active: updated.is_active !== false,
          tenant_name: tenantName,
          district_name: districtName,
        },
      });
    }

    if (action === "update_admin_email") {
      const next = payload as Record<string, unknown>;
      const id = typeof next.id === "string" ? next.id.trim() : "";
      const authEmail = typeof next.auth_email === "string" ? next.auth_email.trim() : "";

      if (!id || !authEmail || authEmail.length > 320) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const adminScope =
        typeof (payload as Record<string, unknown>).admin_scope === "string"
          ? ((payload as Record<string, unknown>).admin_scope as string).trim()
          : "tenant";
      const targetRole = adminScope === "district" ? "district_admin" : "tenant_admin";
      const { data: current, error: currentError } = await adminClient
        .from("profiles")
        .select("id, tenant_id, district_id, auth_email, role, is_active, created_at")
        .eq("id", id)
        .eq("role", targetRole)
        .single();

      if (currentError || !current) {
        return jsonResponse(400, { error: "Unable to find tenant admin." });
      }

      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id, role")
        .eq("auth_email", authEmail)
        .maybeSingle();

      if (existingProfile && existingProfile.id !== id) {
        return jsonResponse(409, {
          error: "An account with this email already exists. Use a different email.",
        });
      }

      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, {
        email: authEmail,
        email_confirm: true,
      });
      if (authUpdateError) {
        return jsonResponse(400, {
          error: authUpdateError.message || "Unable to update auth email.",
        });
      }

      const { data: updated, error: profileUpdateError } = await adminClient
        .from("profiles")
        .update({ auth_email: authEmail })
        .eq("id", id)
        .eq("role", targetRole)
        .select("id, tenant_id, district_id, auth_email, role, is_active, created_at")
        .single();

      if (profileUpdateError || !updated) {
        return jsonResponse(400, { error: "Unable to update tenant admin email." });
      }

      let tenantName: string | null = null;
      let districtName: string | null = null;
      if (updated.tenant_id) {
        const { data: tenant } = await adminClient
          .from("tenants")
          .select("name")
          .eq("id", updated.tenant_id)
          .single();
        tenantName = tenant?.name ?? null;
      }
      if (updated.district_id) {
        const { data: district } = await adminClient
          .from("districts")
          .select("name")
          .eq("id", updated.district_id)
          .single();
        districtName = district?.name ?? null;
      }

      await writeAudit(
        targetRole === "district_admin" ? "update_district_admin_email" : "update_tenant_admin_email",
        "profile",
        updated.id,
        {
        previous_auth_email: current.auth_email,
        auth_email: updated.auth_email,
        }
      );

      return jsonResponse(200, {
        data: {
          ...updated,
          is_active: updated.is_active !== false,
          tenant_name: tenantName,
          district_name: districtName,
        },
      });
    }

    if (action === "send_reset") {
      const next = payload as Record<string, unknown>;
      const authEmail = typeof next.auth_email === "string" ? next.auth_email.trim() : "";
      if (!authEmail) {
        return jsonResponse(400, { error: "Invalid request" });
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

      const adminScope =
        typeof (payload as Record<string, unknown>).admin_scope === "string"
          ? ((payload as Record<string, unknown>).admin_scope as string).trim()
          : "tenant";
      await writeAudit(
        adminScope === "district" ? "send_district_admin_reset" : "send_tenant_admin_reset",
        "profile",
        null,
        { auth_email: authEmail }
      );

      return jsonResponse(200, { data: { success: true } });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    console.error("super-admin-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
