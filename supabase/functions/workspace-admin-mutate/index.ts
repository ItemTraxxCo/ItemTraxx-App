import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { validateAccountDeviceSession } from "../_shared/accountSessions.ts";
import {
  optionalText,
  requireEmail,
  requireUuid,
  ValidationError,
} from "../_shared/validation.ts";

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
  console.error("workspace-admin-mutate missing ITX_PASSWORD_RESET_REDIRECT_URL");
  return null;
};

const randomPassword = () => `${crypto.randomUUID()}-Aa1!`;
const WORKSPACE_ADMIN_INVITE_ACCEPTED_MESSAGE =
  "If this email is eligible, a workspace admin invitation will be sent.";

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

  const ingressError = await requireTrustedEdgeIngress(req, "workspace-admin-mutate", jsonResponse);
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
      .select("id, workspace_id, role, auth_email, is_active")
      .eq("id", user.id)
      .single();

    if (
      profileError ||
      !requesterProfile?.workspace_id ||
      requesterProfile.role !== "workspace_admin" ||
      requesterProfile.is_active === false
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: tenant, error: tenantError } = await adminClient
      .from("workspaces")
      .select("id, primary_admin_profile_id")
      .eq("id", requesterProfile.workspace_id)
      .single();

    if (tenantError || !tenant?.id) {
      return jsonResponse(400, { error: "Unable to load workspace." });
    }

    const canManageAdmins =
      !!tenant.primary_admin_profile_id && tenant.primary_admin_profile_id === requesterProfile.id;

    const writeAudit = async (
      actionType: string,
      entityId: string | null,
      metadata: Record<string, unknown>
    ) => {
      const { error } = await adminClient.from("admin_audit_logs").insert({
        workspace_id: requesterProfile.workspace_id,
        actor_id: requesterProfile.id,
        action_type: actionType,
        entity_type: "profile",
        entity_id: entityId,
        metadata,
      });
      if (error) throw new Error("Unable to write security audit log.");
    };

    const { action, payload } = await readJsonBody(req);
    if (typeof action !== "string" || typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const isMutationAction = action !== "list_workspace_admins";
    if (isMutationAction) {
      const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
        "consume_rate_limit",
        {
          p_scope: "admin",
          p_limit: 20,
          p_window_seconds: 60,
        }
      );

      if (rateLimitError) {
        console.error("workspace-admin-mutate rate limit unavailable", {
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
    }

    const next = payload as Record<string, unknown>;
    const deviceId = optionalText(next.device_id, { maxLen: 128 });
    if (!deviceId) {
      return jsonResponse(400, { error: "Device session is required." });
    }
    const activeSession = await validateAccountDeviceSession(adminClient, {
      workspaceId: requesterProfile.workspace_id,
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

    if (action === "list_workspace_admins") {
      const { data: admins, error } = await adminClient
        .from("profiles")
        .select("id, workspace_id, auth_email, role, is_active, created_at")
        .eq("workspace_id", requesterProfile.workspace_id)
        .eq("role", "workspace_admin")
        .order("created_at", { ascending: true });

      if (error) {
        return jsonResponse(400, { error: "Unable to load workspace admins." });
      }

      return jsonResponse(200, {
        data: {
          admins: ((admins ?? []) as Array<{
            id: string;
            workspace_id: string;
            auth_email: string | null;
            role: string;
            is_active: boolean | null;
            created_at: string;
          }>).map((item) => ({
            id: item.id,
            workspace_id: item.workspace_id,
            auth_email: item.auth_email ?? "",
            role: "workspace_admin",
            is_active: item.is_active !== false,
            created_at: item.created_at,
            is_primary_admin: item.id === tenant.primary_admin_profile_id,
          })),
          can_manage_admins: canManageAdmins,
          primary_admin_profile_id: tenant.primary_admin_profile_id ?? null,
        },
      });
    }

    if (action === "list_tenant_accounts") {
      const { data, error } = await adminClient.from("profiles").select("id,workspace_id,auth_email,role,is_active,deleted_at,created_at").eq("workspace_id", requesterProfile.workspace_id).eq("role", "tenant_account").is("deleted_at", null).order("created_at", { ascending: true });
      if (error) return jsonResponse(400, { error: "Unable to load Tenant Accounts." });
      return jsonResponse(200, { data: data ?? [] });
    }

    if (action === "create_tenant_account") {
      const authEmail = requireEmail(next.auth_email);
      const { data: createdAuth, error: createError } = await adminClient.auth.admin.createUser({ email: authEmail, password: randomPassword(), email_confirm: true });
      if (createError || !createdAuth.user) return jsonResponse(400, { error: "Unable to create Tenant Account." });
      const { data: created, error } = await adminClient.from("profiles").insert({ id: createdAuth.user.id, workspace_id: requesterProfile.workspace_id, auth_email: authEmail, role: "tenant_account", is_active: true }).select("id,workspace_id,auth_email,role,is_active,deleted_at,created_at").single();
      if (error || !created) { await adminClient.auth.admin.deleteUser(createdAuth.user.id); return jsonResponse(400, { error: "Unable to create Tenant Account." }); }
      const redirectTo=resolveResetRedirectTo(req); if (!redirectTo) return jsonResponse(500,{error:"Password reset redirect is not configured."});
      await adminClient.auth.resetPasswordForEmail(authEmail,{redirectTo}); await writeAudit("create_tenant_account",created.id,{auth_email:authEmail}); return jsonResponse(200,{data:created});
    }

    if (["set_tenant_account_status","update_tenant_account_email","remove_tenant_account","send_tenant_account_reset"].includes(action)) {
      const id=requireUuid(next.id); const { data: target }=await adminClient.from("profiles").select("id,auth_email").eq("id",id).eq("workspace_id",requesterProfile.workspace_id).eq("role","tenant_account").is("deleted_at",null).maybeSingle(); if(!target)return jsonResponse(404,{error:"Tenant Account not found."});
      if(action==="send_tenant_account_reset"){const redirectTo=resolveResetRedirectTo(req);if(!redirectTo)return jsonResponse(500,{error:"Password reset redirect is not configured."});const{error}=await adminClient.auth.resetPasswordForEmail(target.auth_email,{redirectTo});if(error)return jsonResponse(400,{error:"Unable to send password reset."});await writeAudit(action,id,{});return jsonResponse(200,{data:{success:true}});}
      if(action==="set_tenant_account_status"){if(typeof next.is_active!=="boolean")return jsonResponse(400,{error:"Invalid request"});const{data,error}=await adminClient.from("profiles").update({is_active:next.is_active}).eq("id",id).select("id,workspace_id,auth_email,role,is_active,deleted_at,created_at").single();if(error)return jsonResponse(400,{error:"Unable to update Tenant Account."});await writeAudit(action,id,{is_active:next.is_active});return jsonResponse(200,{data});}
      if(action==="update_tenant_account_email"){const authEmail=requireEmail(next.auth_email);const{error:authError}=await adminClient.auth.admin.updateUserById(id,{email:authEmail,email_confirm:true});if(authError)return jsonResponse(400,{error:"Unable to update email."});const{data,error}=await adminClient.from("profiles").update({auth_email:authEmail}).eq("id",id).select("id,workspace_id,auth_email,role,is_active,deleted_at,created_at").single();if(error)return jsonResponse(400,{error:"Unable to update Tenant Account."});await writeAudit(action,id,{auth_email:authEmail});return jsonResponse(200,{data});}
      const now=new Date().toISOString();const{error}=await adminClient.from("profiles").update({deleted_at:now,is_active:false}).eq("id",id);if(error)return jsonResponse(400,{error:"Unable to remove Tenant Account."});await adminClient.from("account_sessions").update({revoked_at:now,revoked_by:user.id}).eq("profile_id",id).is("revoked_at",null);await writeAudit(action,id,{});return jsonResponse(200,{data:{success:true}});
    }

    if (!canManageAdmins) {
      return jsonResponse(403, { error: "Primary admin access required." });
    }

    if (action === "create_workspace_admin") {
      const authEmail = requireEmail(next.auth_email);

      const acceptedInviteResponse = () =>
        jsonResponse(200, {
          data: {
            success: true,
            auth_email: authEmail,
            message: WORKSPACE_ADMIN_INVITE_ACCEPTED_MESSAGE,
          },
        });

      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("auth_email", authEmail)
        .maybeSingle();

      if (existingProfile?.id) {
        console.info("workspace-admin-mutate invite skipped for existing profile", {
          workspace_id: requesterProfile.workspace_id,
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
          console.info("workspace-admin-mutate invite skipped for existing auth user", {
            workspace_id: requesterProfile.workspace_id,
            actor_id: requesterProfile.id,
          });
          return acceptedInviteResponse();
        }
        return jsonResponse(400, {
          error: "Unable to process workspace admin invitation.",
        });
      }

      const userId = createdAuth.user.id;
      const { data: createdProfile, error: insertProfileError } = await adminClient
        .from("profiles")
        .insert({
          id: userId,
          workspace_id: requesterProfile.workspace_id,
          auth_email: authEmail,
          role: "workspace_admin",
          is_active: true,
        })
        .select("id, workspace_id, auth_email, role, is_active, created_at")
        .single();

      if (insertProfileError || !createdProfile) {
        await adminClient.auth.admin.deleteUser(userId);
        return jsonResponse(400, {
          error: "Unable to process workspace admin invitation.",
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
          error: "Unable to send workspace admin invitation.",
        });
      }

      await writeAudit("create_workspace_admin", createdProfile.id, {
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
      const id = requireUuid(next.id);
      const isActive = next.is_active;
      if (typeof isActive !== "boolean") {
        return jsonResponse(400, { error: "Invalid request" });
      }
      if (id === tenant.primary_admin_profile_id) {
        return jsonResponse(400, { error: "Primary admin status cannot be changed here." });
      }

      const { data: updated, error: updateError } = await adminClient
        .from("profiles")
        .update({ is_active: isActive })
        .eq("id", id)
        .eq("workspace_id", requesterProfile.workspace_id)
        .eq("role", "workspace_admin")
        .select("id, workspace_id, auth_email, role, is_active, created_at")
        .single();

      if (updateError || !updated) {
        return jsonResponse(400, { error: "Unable to update workspace admin status." });
      }

      await writeAudit(isActive ? "enable_workspace_admin" : "disable_workspace_admin", updated.id, {
        auth_email: updated.auth_email,
      });

      return jsonResponse(200, {
        data: {
          id: updated.id,
          workspace_id: updated.workspace_id,
          auth_email: updated.auth_email ?? "",
          role: "workspace_admin",
          is_active: updated.is_active !== false,
          created_at: updated.created_at,
          is_primary_admin: false,
        },
      });
    }

    if (action === "update_admin_email") {
      const id = requireUuid(next.id);
      const authEmail = requireEmail(next.auth_email);
      if (id === tenant.primary_admin_profile_id) {
        return jsonResponse(400, { error: "Primary admin email cannot be changed here." });
      }

      const { data: current, error: currentError } = await adminClient
        .from("profiles")
        .select("id, workspace_id, auth_email")
        .eq("id", id)
        .eq("workspace_id", requesterProfile.workspace_id)
        .eq("role", "workspace_admin")
        .single();

      if (currentError || !current) {
        return jsonResponse(400, { error: "Unable to find workspace admin." });
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
          error: "Unable to update auth email.",
        });
      }

      const { data: updated, error: profileUpdateError } = await adminClient
        .from("profiles")
        .update({ auth_email: authEmail })
        .eq("id", id)
        .eq("workspace_id", requesterProfile.workspace_id)
        .eq("role", "workspace_admin")
        .select("id, workspace_id, auth_email, role, is_active, created_at")
        .single();

      if (profileUpdateError || !updated) {
        return jsonResponse(400, { error: "Unable to update workspace admin email." });
      }

      await writeAudit("update_workspace_admin_email", updated.id, {
        previous_auth_email: current.auth_email,
        auth_email: updated.auth_email,
      });

      return jsonResponse(200, {
        data: {
          id: updated.id,
          workspace_id: updated.workspace_id,
          auth_email: updated.auth_email ?? "",
          role: "workspace_admin",
          is_active: updated.is_active !== false,
          created_at: updated.created_at,
          is_primary_admin: false,
        },
      });
    }

    if (action === "send_workspace_admin_reset") {
      const authEmail = requireEmail(next.auth_email);

      const { data: target, error: targetError } = await adminClient
        .from("profiles")
        .select("id, auth_email")
        .eq("workspace_id", requesterProfile.workspace_id)
        .eq("role", "workspace_admin")
        .eq("auth_email", authEmail)
        .single();

      if (targetError || !target?.auth_email) {
        return jsonResponse(400, { error: "Unable to find workspace admin." });
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

      await writeAudit("send_workspace_admin_reset", target.id, {
        auth_email: target.auth_email,
      });

      return jsonResponse(200, { data: { success: true } });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("workspace-admin-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
