import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getExternalAuthUser } from "../_shared/externalAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { validateAccountDeviceSession } from "../_shared/accountSessions.ts";
import { callBetterAuthAdmin } from "../_shared/betterAuthAdmin.ts";
import { sha256Hex } from "../_shared/sha256.ts";
import { resolveWorkspaceAccess } from "../_shared/workspaceAccess.ts";
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

const resolveResetRedirectTo = () => {
  const configured = (Deno.env.get("ITX_PASSWORD_RESET_REDIRECT_URL") ?? "").trim();
  if (configured) return configured;
  console.error("workspace-admin-mutate missing ITX_PASSWORD_RESET_REDIRECT_URL");
  return null;
};

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const resolveAccountFlowURL = (path: "/accept-invitation" | "/account/email-change", params: Record<string, string>) => {
  const configured = resolveResetRedirectTo();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    url.pathname = path;
    url.search = "";
    url.hash = "";
    const fragment = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => fragment.set(key, value));
    url.hash = fragment.toString();
    return url.toString();
  } catch {
    return null;
  }
};

const WORKSPACE_INVITATION_MESSAGE =
  "If the address is eligible, invitation instructions will be sent. The account will appear after the recipient accepts.";

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

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
    } = await getExternalAuthUser(userClient, req.headers.get("Authorization") ?? "");

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
      .select("id, status, primary_admin_profile_id")
      .eq("id", requesterProfile.workspace_id)
      .single();

    if (tenantError || !tenant?.id) {
      return jsonResponse(400, { error: "Unable to load workspace." });
    }

    const workspaceAccess = resolveWorkspaceAccess(tenant, tenantError);
    if (!workspaceAccess.allowed) {
      return workspaceAccess.reason === "disabled"
        ? jsonResponse(403, { error: "Workspace disabled" })
        : jsonResponse(503, { error: "Workspace status unavailable" });
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

    const inviteWorkspaceAccount = async (
      authEmail: string,
      accountRole: "tenant_account" | "workspace_admin",
    ) => {
      const rawToken = randomToken();
      const invitationUrl = resolveAccountFlowURL("/accept-invitation", {
        token: rawToken,
      });
      if (!invitationUrl) {
        return jsonResponse(500, { error: "Unable to process this invitation. Try again." });
      }

      const { data: invitationResult, error: invitationError } = await adminClient.rpc(
        "create_workspace_account_invitation",
        {
          p_workspace_id: requesterProfile.workspace_id,
          p_inviter_profile_id: requesterProfile.id,
          p_email: authEmail,
          p_account_role: accountRole,
          p_token_hash: await sha256Hex(rawToken),
          p_expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        },
      );
      if (
        invitationError ||
        !invitationResult ||
        typeof invitationResult !== "object" ||
        typeof (invitationResult as { send_email?: unknown }).send_email !== "boolean"
      ) {
        const isAdminLimit = /administrator limit reached/i.test(invitationError?.message ?? "");
        return isAdminLimit
          ? jsonResponse(409, { error: "Workspace administrator limit reached." })
          : jsonResponse(400, { error: "Unable to process this invitation. Try again." });
      }

      if (!(invitationResult as { send_email: boolean }).send_email) {
        return jsonResponse(409, {
          error: "An existing invitation cannot be changed with this action. Ask the primary admin to review it.",
        });
      }

      try {
        await callBetterAuthAdmin({
          action: "send_workspace_account_invitation",
          email: authEmail,
          accountRole,
          url: invitationUrl,
        });
      } catch {
        return jsonResponse(503, { error: "Unable to send invitation instructions. Try again." });
      }

      await writeAudit("invite_workspace_account", null, {
        account_role: accountRole,
      });
      return jsonResponse(200, {
        data: { success: true, message: WORKSPACE_INVITATION_MESSAGE },
      });
    };

    const { action, payload } = await readJsonBody(req);
    if (typeof action !== "string" || typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    if (action === "update_admin_email" || action === "update_tenant_account_email") {
      return jsonResponse(400, { error: "Invalid action" });
    }

    const isMutationAction = !["list_workspace_admins", "list_workspace_accounts"].includes(action);
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

    if (action === "list_workspace_accounts") {
      const { data: accounts, error } = await adminClient
        .from("profiles")
        .select("id, workspace_id, auth_email, role, is_active, created_at")
        .eq("workspace_id", requesterProfile.workspace_id)
        .in("role", ["tenant_account", "workspace_admin"])
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (error) {
        return jsonResponse(400, { error: "Unable to load workspace accounts." });
      }

      return jsonResponse(200, {
        data: {
          accounts: ((accounts ?? []) as Array<{
            id: string;
            workspace_id: string;
            auth_email: string | null;
            role: "tenant_account" | "workspace_admin";
            is_active: boolean | null;
            created_at: string;
          }>).map((item) => ({
            ...item,
            auth_email: item.auth_email ?? "",
            is_active: item.is_active !== false,
            is_primary_admin: item.id === tenant.primary_admin_profile_id,
          })),
          can_manage_admins: canManageAdmins,
        },
      });
    }

    if (action === "set_workspace_account_role") {
      const id = requireUuid(next.id);
      const role = next.role;
      if (role !== "tenant_account" && role !== "workspace_admin") {
        return jsonResponse(400, { error: "Invalid account role." });
      }

      const { data: target, error: targetError } = await adminClient
        .from("profiles")
        .select("id, workspace_id, auth_email, role, is_active, created_at, better_auth_user_id")
        .eq("id", id)
        .eq("workspace_id", requesterProfile.workspace_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (targetError) {
        return jsonResponse(500, { error: "Unable to load the workspace account." });
      }
      if (!target || (target.role !== "tenant_account" && target.role !== "workspace_admin")) {
        return jsonResponse(404, { error: "Workspace account not found." });
      }
      if (id === tenant.primary_admin_profile_id && role !== "workspace_admin") {
        return jsonResponse(400, { error: "The primary admin role cannot be changed." });
      }
      if (
        target.role === "workspace_admin" &&
        role === "tenant_account" &&
        !canManageAdmins
      ) {
        return jsonResponse(403, { error: "Primary admin access is required to demote a workspace admin." });
      }
      if (id === requesterProfile.id && role !== "workspace_admin") {
        return jsonResponse(400, { error: "You cannot change your own workspace role." });
      }

      if (target.role === role) {
        return jsonResponse(200, {
          data: {
            id: target.id,
            workspace_id: target.workspace_id,
            auth_email: target.auth_email ?? "",
            role: target.role,
            is_active: target.is_active !== false,
            created_at: target.created_at,
            is_primary_admin: target.id === tenant.primary_admin_profile_id,
          },
        });
      }
      if (!canManageAdmins) {
        return jsonResponse(403, {
          error: "Primary admin access is required to change workspace account roles.",
        });
      }
      if (!target.better_auth_user_id) {
        return jsonResponse(409, {
          error: "This account must complete its first sign-in before its role can be changed.",
        });
      }

      const { error: roleUpdateError } = await adminClient.rpc(
        "workspace_admin_set_profile_role",
        {
          p_actor_profile_id: requesterProfile.id,
          p_workspace_id: requesterProfile.workspace_id,
          p_profile_id: id,
          p_role: role,
        },
      );
      if (roleUpdateError) {
        console.error("workspace-admin-mutate role update failed", {
          message: roleUpdateError.message,
          code: (roleUpdateError as { code?: string }).code,
        });
        return jsonResponse(400, { error: "Unable to update this account's role." });
      }

      const { data: updated, error: reloadError } = await adminClient
        .from("profiles")
        .select("id, workspace_id, auth_email, role, is_active, created_at")
        .eq("id", id)
        .eq("workspace_id", requesterProfile.workspace_id)
        .single();
      if (reloadError || !updated) {
        return jsonResponse(500, { error: "Role changed, but the updated account could not be reloaded." });
      }

      return jsonResponse(200, {
        data: {
          ...updated,
          auth_email: updated.auth_email ?? "",
          is_active: updated.is_active !== false,
          is_primary_admin: updated.id === tenant.primary_admin_profile_id,
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
      return await inviteWorkspaceAccount(authEmail, "tenant_account");
    }

    if (["set_tenant_account_status","remove_tenant_account","send_tenant_account_reset"].includes(action)) {
      const id=requireUuid(next.id); const { data: target }=await adminClient.from("profiles").select("id,auth_email").eq("id",id).eq("workspace_id",requesterProfile.workspace_id).eq("role","tenant_account").is("deleted_at",null).maybeSingle(); if(!target)return jsonResponse(404,{error:"Tenant Account not found."});
      if(action==="send_tenant_account_reset"){const redirectTo=resolveResetRedirectTo();if(!redirectTo)return jsonResponse(500,{error:"Password reset redirect is not configured."});await callBetterAuthAdmin({action:"request_password_reset",profileId:id,redirectTo});await writeAudit(action,id,{});return jsonResponse(200,{data:{success:true}});}
      if(action==="set_tenant_account_status"){if(typeof next.is_active!=="boolean")return jsonResponse(400,{error:"Invalid request"});const{data,error}=await adminClient.from("profiles").update({is_active:next.is_active}).eq("id",id).select("id,workspace_id,auth_email,role,is_active,deleted_at,created_at").single();if(error)return jsonResponse(400,{error:"Unable to update Tenant Account."});await writeAudit(action,id,{is_active:next.is_active});return jsonResponse(200,{data});}
      const now=new Date().toISOString();const{error}=await adminClient.from("profiles").update({deleted_at:now,is_active:false}).eq("id",id);if(error)return jsonResponse(400,{error:"Unable to remove Tenant Account."});await adminClient.from("account_sessions").update({revoked_at:now,revoked_by:user.id}).eq("profile_id",id).is("revoked_at",null);await writeAudit(action,id,{});return jsonResponse(200,{data:{success:true}});
    }

    if (!canManageAdmins) {
      return jsonResponse(403, { error: "Primary admin access required." });
    }

    if (action === "create_workspace_admin") {
      const authEmail = requireEmail(next.auth_email);
      return await inviteWorkspaceAccount(authEmail, "workspace_admin");
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
      if (isActive === false) {
        try {
          await callBetterAuthAdmin({ action: "revoke_sessions", profileId: id });
        } catch {
          return jsonResponse(503, { error: "Unable to revoke workspace admin sessions." });
        }
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

      const redirectTo = resolveResetRedirectTo();
      if (!redirectTo) {
        return jsonResponse(500, {
          error: "Password reset redirect is not configured.",
        });
      }
      try { await callBetterAuthAdmin({action:"request_password_reset",profileId:target.id,redirectTo}); } catch {
        return jsonResponse(400, {
          error: "Unable to send password reset.",
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
