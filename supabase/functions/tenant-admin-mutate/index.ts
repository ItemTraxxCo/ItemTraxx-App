import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../_shared/privilegedStepUp.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { validateTenantAdminDeviceSession } from "../_shared/tenantAdminSessions.ts";

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
  console.error("tenant-admin-mutate missing ITX_PASSWORD_RESET_REDIRECT_URL");
  return null;
};

const randomPassword = () => `${crypto.randomUUID()}-Aa1!`;
const TENANT_ADMIN_INVITE_ACCEPTED_MESSAGE =
  "If this email is eligible, a tenant admin invitation will be sent.";

const sanitizeText = (value: unknown, maxLen: number) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
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

  const ingressError = await requireTrustedEdgeIngress(req, "tenant-admin-mutate", jsonResponse);
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

    const { data: requesterProfile, error: profileError } = await userClient
      .from("profiles")
      .select("id, tenant_id, role, auth_email, is_active")
      .eq("id", user.id)
      .single();

    if (
      profileError ||
      !requesterProfile?.tenant_id ||
      requesterProfile.role !== "tenant_admin" ||
      requesterProfile.is_active === false
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    try {
      const hasStepUp = await hasPrivilegedStepUp(adminClient, {
        userId: user.id,
        roleScope: "tenant_admin",
        authToken,
      });
      if (!hasStepUp) {
        return jsonResponse(403, { error: "Admin verification required." });
      }
    } catch (error) {
      if (isMissingPrivilegedStepUpTable(error as { code?: string; message?: string })) {
        return jsonResponse(503, {
          error: "Privileged verification controls unavailable. Run latest SQL setup.",
        });
      }
      throw error;
    }

    const { data: rateLimit, error: rateLimitError } = await adminClient.rpc(
      "consume_rate_limit",
      {
        p_scope: "admin",
        p_limit: 20,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      console.error("tenant-admin-mutate rate limit unavailable", {
        message: rateLimitError.message,
        code: (rateLimitError as { code?: string }).code,
      });
      return jsonResponse(500, { error: "Rate limit check failed" });
    } else {
      const rateLimitResult = rateLimit as RateLimitResult;
      if (!rateLimitResult.allowed) {
        return jsonResponse(429, {
          error: "Rate limit exceeded, please try again in a minute.",
        });
      }
    }

    const { data: tenant, error: tenantError } = await adminClient
      .from("tenants")
      .select("id, primary_admin_profile_id")
      .eq("id", requesterProfile.tenant_id)
      .single();

    if (tenantError || !tenant?.id) {
      return jsonResponse(400, { error: "Unable to load tenant." });
    }

    const canManageAdmins =
      !!tenant.primary_admin_profile_id && tenant.primary_admin_profile_id === requesterProfile.id;

    const writeAudit = async (
      actionType: string,
      entityId: string | null,
      metadata: Record<string, unknown>
    ) => {
      await adminClient.from("admin_audit_logs").insert({
        tenant_id: requesterProfile.tenant_id,
        actor_id: requesterProfile.id,
        action_type: actionType,
        entity_type: "profile",
        entity_id: entityId,
        metadata,
      });
    };

    const { action, payload } = await req.json();
    if (typeof action !== "string" || typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
    }
    const next = payload as Record<string, unknown>;
    const deviceId = sanitizeText(next.device_id, 128);
    const activeSession = await validateTenantAdminDeviceSession(adminClient, {
      tenantId: requesterProfile.tenant_id,
      profileId: requesterProfile.id,
      deviceId,
      authToken,
    });
    if (activeSession.relationMissing) {
      return jsonResponse(503, {
        error: "Session controls unavailable. Run latest SQL setup.",
      });
    }
    if (!activeSession.valid) {
      return jsonResponse(401, { error: "Session revoked" });
    }

    if (action === "list_tenant_admins") {
      const { data: admins, error } = await adminClient
        .from("profiles")
        .select("id, tenant_id, auth_email, role, is_active, created_at")
        .eq("tenant_id", requesterProfile.tenant_id)
        .eq("role", "tenant_admin")
        .order("created_at", { ascending: true });

      if (error) {
        return jsonResponse(400, { error: "Unable to load tenant admins." });
      }

      return jsonResponse(200, {
        data: {
          admins: ((admins ?? []) as Array<{
            id: string;
            tenant_id: string;
            auth_email: string | null;
            role: string;
            is_active: boolean | null;
            created_at: string;
          }>).map((item) => ({
            id: item.id,
            tenant_id: item.tenant_id,
            auth_email: item.auth_email ?? "",
            role: "tenant_admin",
            is_active: item.is_active !== false,
            created_at: item.created_at,
            is_primary_admin: item.id === tenant.primary_admin_profile_id,
          })),
          can_manage_admins: canManageAdmins,
          primary_admin_profile_id: tenant.primary_admin_profile_id ?? null,
        },
      });
    }

    if (!canManageAdmins) {
      return jsonResponse(403, { error: "Primary admin access required." });
    }

    if (action === "create_tenant_admin") {
      const authEmail =
        typeof next.auth_email === "string" ? next.auth_email.trim().toLowerCase() : "";
      if (!authEmail || authEmail.length > 320) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const acceptedInviteResponse = () =>
        jsonResponse(200, {
          data: {
            success: true,
            auth_email: authEmail,
            message: TENANT_ADMIN_INVITE_ACCEPTED_MESSAGE,
          },
        });

      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("auth_email", authEmail)
        .maybeSingle();

      if (existingProfile?.id) {
        console.info("tenant-admin-mutate invite skipped for existing profile", {
          tenant_id: requesterProfile.tenant_id,
          actor_id: requesterProfile.id,
        });
        return acceptedInviteResponse();
      }

      const { data: createdAuth, error: createUserError } = await adminClient.auth.admin.createUser(
        {
          email: authEmail,
          password: randomPassword(),
          email_confirm: true,
        }
      );

      if (createUserError || !createdAuth.user?.id) {
        const message = lower(createUserError?.message);
        if (
          message.includes("already") ||
          message.includes("registered") ||
          message.includes("exists")
        ) {
          console.info("tenant-admin-mutate invite skipped for existing auth user", {
            tenant_id: requesterProfile.tenant_id,
            actor_id: requesterProfile.id,
          });
          return acceptedInviteResponse();
        }
        return jsonResponse(400, {
          error: "Unable to process tenant admin invitation.",
        });
      }

      const userId = createdAuth.user.id;
      const { data: createdProfile, error: insertProfileError } = await adminClient
        .from("profiles")
        .insert({
          id: userId,
          tenant_id: requesterProfile.tenant_id,
          district_id: null,
          auth_email: authEmail,
          role: "tenant_admin",
          is_active: true,
        })
        .select("id, tenant_id, auth_email, role, is_active, created_at")
        .single();

      if (insertProfileError || !createdProfile) {
        await adminClient.auth.admin.deleteUser(userId);
        return jsonResponse(400, {
          error: "Unable to process tenant admin invitation.",
        });
      }

      const redirectTo = resolveResetRedirectTo(req);
      if (!redirectTo) {
        await adminClient.from("profiles").delete().eq("id", userId);
        await adminClient.auth.admin.deleteUser(userId);
        return jsonResponse(500, {
          error: "Password reset redirect is not configured.",
        });
      }
      const { error: resetError } = await adminClient.auth.resetPasswordForEmail(
        authEmail,
        { redirectTo }
      );

      if (resetError) {
        await adminClient.from("profiles").delete().eq("id", userId);
        await adminClient.auth.admin.deleteUser(userId);
        return jsonResponse(400, {
          error: "Unable to send tenant admin invitation.",
        });
      }

      await writeAudit("create_tenant_admin", createdProfile.id, {
        auth_email: authEmail,
      });

      return jsonResponse(200, {
        data: {
          success: true,
          auth_email: authEmail,
        },
      });
    }

    if (action === "set_admin_status") {
      const id = typeof next.id === "string" ? next.id.trim() : "";
      const isActive = next.is_active;
      if (!id || typeof isActive !== "boolean") {
        return jsonResponse(400, { error: "Invalid request" });
      }
      if (id === tenant.primary_admin_profile_id) {
        return jsonResponse(400, { error: "Primary admin status cannot be changed here." });
      }

      const { data: updated, error: updateError } = await adminClient
        .from("profiles")
        .update({ is_active: isActive })
        .eq("id", id)
        .eq("tenant_id", requesterProfile.tenant_id)
        .eq("role", "tenant_admin")
        .select("id, tenant_id, auth_email, role, is_active, created_at")
        .single();

      if (updateError || !updated) {
        return jsonResponse(400, { error: "Unable to update tenant admin status." });
      }

      await writeAudit(isActive ? "enable_tenant_admin" : "disable_tenant_admin", updated.id, {
        auth_email: updated.auth_email,
      });

      return jsonResponse(200, {
        data: {
          id: updated.id,
          tenant_id: updated.tenant_id,
          auth_email: updated.auth_email ?? "",
          role: "tenant_admin",
          is_active: updated.is_active !== false,
          created_at: updated.created_at,
          is_primary_admin: false,
        },
      });
    }

    if (action === "update_admin_email") {
      const id = typeof next.id === "string" ? next.id.trim() : "";
      const authEmail =
        typeof next.auth_email === "string" ? next.auth_email.trim().toLowerCase() : "";
      if (!id || !authEmail || authEmail.length > 320) {
        return jsonResponse(400, { error: "Invalid request" });
      }
      if (id === tenant.primary_admin_profile_id) {
        return jsonResponse(400, { error: "Primary admin email cannot be changed here." });
      }

      const { data: current, error: currentError } = await adminClient
        .from("profiles")
        .select("id, tenant_id, auth_email")
        .eq("id", id)
        .eq("tenant_id", requesterProfile.tenant_id)
        .eq("role", "tenant_admin")
        .single();

      if (currentError || !current) {
        return jsonResponse(400, { error: "Unable to find tenant admin." });
      }

      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("auth_email", authEmail)
        .maybeSingle();

      if (existingProfile && existingProfile.id !== id) {
        return jsonResponse(409, {
          error: "An account with this email already exists.",
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
        .eq("tenant_id", requesterProfile.tenant_id)
        .eq("role", "tenant_admin")
        .select("id, tenant_id, auth_email, role, is_active, created_at")
        .single();

      if (profileUpdateError || !updated) {
        return jsonResponse(400, { error: "Unable to update tenant admin email." });
      }

      await writeAudit("update_tenant_admin_email", updated.id, {
        previous_auth_email: current.auth_email,
        auth_email: updated.auth_email,
      });

      return jsonResponse(200, {
        data: {
          id: updated.id,
          tenant_id: updated.tenant_id,
          auth_email: updated.auth_email ?? "",
          role: "tenant_admin",
          is_active: updated.is_active !== false,
          created_at: updated.created_at,
          is_primary_admin: false,
        },
      });
    }

    if (action === "send_tenant_admin_reset") {
      const authEmail =
        typeof next.auth_email === "string" ? next.auth_email.trim().toLowerCase() : "";
      if (!authEmail) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data: target, error: targetError } = await adminClient
        .from("profiles")
        .select("id, auth_email")
        .eq("tenant_id", requesterProfile.tenant_id)
        .eq("role", "tenant_admin")
        .eq("auth_email", authEmail)
        .single();

      if (targetError || !target?.auth_email) {
        return jsonResponse(400, { error: "Unable to find tenant admin." });
      }
      if (target.id === tenant.primary_admin_profile_id) {
        return jsonResponse(400, { error: "Primary admin reset must be handled separately." });
      }

      const redirectTo = resolveResetRedirectTo(req);
      if (!redirectTo) {
        return jsonResponse(500, {
          error: "Password reset redirect is not configured.",
        });
      }
      const { error: resetError } = await adminClient.auth.resetPasswordForEmail(
        target.auth_email,
        { redirectTo }
      );

      if (resetError) {
        return jsonResponse(400, {
          error: `Unable to send password reset. ${resetError.message}`,
        });
      }

      await writeAudit("send_tenant_admin_reset", target.id, {
        auth_email: target.auth_email,
      });

      return jsonResponse(200, { data: { success: true } });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    console.error("tenant-admin-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
