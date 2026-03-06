import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const hasOrigin = !!origin;
  const originAllowed = !hasOrigin || allowedOrigins.includes(origin as string);
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
    if (!originAllowed) return new Response("Origin not allowed", { status: 403, headers });
    return new Response("ok", { headers });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
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
      .select("role, district_id, auth_email")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "district_admin" || !profile.district_id) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

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

    const normalizeSupportText = (value: unknown, max = 4000) =>
      typeof value === "string" ? value.trim().slice(0, max) : "";

    const isValidTenantStatus = (
      value: unknown
    ): value is "active" | "suspended" | "archived" =>
      value === "active" || value === "suspended" || value === "archived";

    const isValidSupportPriority = (
      value: unknown
    ): value is "low" | "normal" | "high" | "urgent" =>
      value === "low" || value === "normal" || value === "high" || value === "urgent";

    const getTenantForDistrict = async (tenantId: string) => {
      const { data: tenant, error } = await adminClient
        .from("tenants")
        .select("id, name, access_code, status, created_at, district_id, primary_admin_profile_id")
        .eq("id", tenantId)
        .eq("district_id", profile.district_id)
        .single();

      if (error || !tenant) {
        return null;
      }
      return tenant as {
        id: string;
        name: string;
        access_code: string;
        status: "active" | "suspended" | "archived";
        created_at: string;
        district_id: string;
        primary_admin_profile_id?: string | null;
      };
    };

    const enrichTenant = async (tenant: Awaited<ReturnType<typeof getTenantForDistrict>>) => {
      if (!tenant) return null;
      let primaryAdminEmail: string | null = null;
      if (tenant.primary_admin_profile_id) {
        const { data: adminProfile } = await adminClient
          .from("profiles")
          .select("auth_email")
          .eq("id", tenant.primary_admin_profile_id)
          .single();
        primaryAdminEmail = adminProfile?.auth_email ?? null;
      }

      return {
        id: tenant.id,
        name: tenant.name,
        access_code: tenant.access_code,
        status: tenant.status,
        created_at: tenant.created_at,
        primary_admin_email: primaryAdminEmail,
      };
    };

    if (action === "update_tenant") {
      const next = payload as Record<string, unknown>;
      const tenantId = typeof next.id === "string" ? next.id.trim() : "";
      const name = typeof next.name === "string" ? next.name.trim() : "";
      const accessCode = typeof next.access_code === "string" ? next.access_code.trim() : "";

      if (!tenantId || !name || !accessCode) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const current = await getTenantForDistrict(tenantId);
      if (!current) {
        return jsonResponse(404, { error: "Tenant not found." });
      }

      const { error: updateError } = await adminClient
        .from("tenants")
        .update({
          name,
          access_code: accessCode,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tenantId)
        .eq("district_id", profile.district_id);

      if (updateError) {
        return jsonResponse(400, { error: updateError.message || "Unable to update tenant." });
      }

      const updated = await enrichTenant(await getTenantForDistrict(tenantId));
      await writeAudit("district_update_tenant", "tenant", tenantId, {
        district_id: profile.district_id,
        previous_name: current.name,
        name,
        previous_access_code: current.access_code,
        access_code: accessCode,
      });

      return jsonResponse(200, { data: updated });
    }

    if (action === "set_tenant_status") {
      const next = payload as Record<string, unknown>;
      const tenantId = typeof next.id === "string" ? next.id.trim() : "";
      const status = next.status;

      if (!tenantId || !isValidTenantStatus(status)) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const current = await getTenantForDistrict(tenantId);
      if (!current) {
        return jsonResponse(404, { error: "Tenant not found." });
      }

      const { error: updateError } = await adminClient
        .from("tenants")
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tenantId)
        .eq("district_id", profile.district_id);

      if (updateError) {
        return jsonResponse(400, { error: updateError.message || "Unable to update tenant status." });
      }

      const updated = await enrichTenant(await getTenantForDistrict(tenantId));
      await writeAudit(
        status === "active"
          ? "district_enable_tenant"
          : status === "archived"
            ? "district_archive_tenant"
            : "district_suspend_tenant",
        "tenant",
        tenantId,
        {
          district_id: profile.district_id,
          previous_status: current.status,
          status,
        }
      );

      return jsonResponse(200, { data: updated });
    }

    if (action === "send_primary_admin_reset") {
      const next = payload as Record<string, unknown>;
      const tenantId = typeof next.tenant_id === "string" ? next.tenant_id.trim() : "";
      if (!tenantId) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const tenant = await getTenantForDistrict(tenantId);
      if (!tenant) {
        return jsonResponse(404, { error: "Tenant not found." });
      }

      if (!tenant.primary_admin_profile_id) {
        return jsonResponse(400, { error: "Tenant does not have a primary admin." });
      }

      const { data: adminProfile, error: adminProfileError } = await adminClient
        .from("profiles")
        .select("auth_email")
        .eq("id", tenant.primary_admin_profile_id)
        .single();

      const authEmail = adminProfile?.auth_email ?? null;
      if (adminProfileError || !authEmail) {
        return jsonResponse(400, { error: "Primary admin email unavailable." });
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

      await writeAudit("district_send_primary_admin_reset", "tenant", tenantId, {
        district_id: profile.district_id,
        auth_email: authEmail,
      });

      return jsonResponse(200, { data: { success: true, auth_email: authEmail } });
    }

    if (action === "create_support_request") {
      const next = payload as Record<string, unknown>;
      const subject = normalizeSupportText(next.subject, 160);
      const message = normalizeSupportText(next.message, 4000);
      const priority = next.priority;

      if (!subject || !message || !isValidSupportPriority(priority)) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const supportPayload = {
        district_id: profile.district_id,
        requester_email: profile.auth_email ?? user.email ?? null,
        requester_name: user.email ?? "District admin",
        subject,
        message,
        priority,
      };

      const { data: requestRow, error: requestError } = await adminClient
        .from("district_support_requests")
        .insert({
          district_id: profile.district_id,
          requested_by: user.id,
          requester_email: profile.auth_email ?? user.email ?? null,
          requester_name: user.email ?? null,
          subject,
          message,
          priority,
          status: "open",
        })
        .select("id, requester_email, requester_name, subject, message, priority, status, created_at")
        .single();

      if (requestError || !requestRow) {
        return jsonResponse(400, { error: "Unable to create support request." });
      }

      await adminClient.rpc("enqueue_async_job", {
        p_job_type: "district_support_email",
        p_payload: supportPayload,
      });

      await writeAudit("district_create_support_request", "district", profile.district_id, {
        subject,
        priority,
      });

      return jsonResponse(200, { data: requestRow });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    console.error("district-admin-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
