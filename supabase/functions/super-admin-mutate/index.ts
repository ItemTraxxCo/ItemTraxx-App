import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getExternalAuthUser } from "../_shared/externalAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { hasPrivilegedStepUp } from "../_shared/privilegedStepUp.ts";
import { isSuperAdminTokenBlockedBySessionRevocation } from "../_shared/superAdminSessions.ts";
import { writeSuperAdminAudit } from "../_shared/superAdminAudit.ts";
import { callBetterAuthAdmin } from "../_shared/betterAuthAdmin.ts";
import {
  optionalText,
  requireEmail,
  requireText,
  requireUuid,
  ValidationError,
} from "../_shared/validation.ts";
import {
  handleTenantAccountAction,
  type TenantAccount,
  type TenantAccountRepository,
} from "./tenantAccounts.ts";
const base = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
const password = () => `${crypto.randomUUID()}-Aa1!`;
serve(async (req) => {
  const origin = req.headers.get("origin"),
    ok = !origin ||
      isAllowedOrigin(
        origin,
        parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS")),
      ),
    headers = {
      ...base,
      ...(origin && ok ? { "Access-Control-Allow-Origin": origin } : {}),
    },
    json = (status: number, body: Record<string, unknown>) =>
      new Response(JSON.stringify({ ok: status < 400, ...body }), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
  if (req.method === "OPTIONS") {
    return ok
      ? new Response("ok", { headers })
      : json(403, { error: "Origin not allowed" });
  }
  if (!ok) return json(403, { error: "Origin not allowed" });
  const ingress = await requireTrustedEdgeIngress(
    req,
    "super-admin-mutate",
    json,
  );
  if (ingress) return ingress;
  if (isKillSwitchWriteBlocked(req)) {
    return json(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }
  try {
    const h = req.headers.get("authorization");
    if (!h) return json(401, { error: "Unauthorized" });
    const token = h.replace(/^Bearer\s+/i, "").trim(),
      url = Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL"),
      key = Deno.env.get("ITX_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"),
      secret = Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || !secret) {
      return json(500, { error: "Server misconfiguration" });
    }
    const uc = createClient(url, key, {
        global: { headers: { Authorization: h } },
        auth: { persistSession: false },
      }),
      admin = createClient(url, secret, { auth: { persistSession: false } }),
      { data: { user } } = await getExternalAuthUser(uc, req.headers.get("Authorization") ?? "");
    if (!user) return json(401, { error: "Unauthorized" });
    const { data: self } = await admin.from("profiles").select("role,is_active")
      .eq("id", user.id).maybeSingle();
    if (self?.role !== "super_admin" || self.is_active === false) {
      return json(403, { error: "Access denied" });
    }
    const revoked = await isSuperAdminTokenBlockedBySessionRevocation(admin, {
      profileId: user.id,
      authToken: token,
    });
    if (revoked.blocked || revoked.relationMissing) {
      return json(revoked.relationMissing ? 503 : 401, {
        error: "Session unavailable",
      });
    }
    if (
      !await hasPrivilegedStepUp(admin, {
        userId: user.id,
        roleScope: "super_admin",
        authToken: token,
      })
    ) return json(403, { error: "Super admin verification required." });
    const body = await readJsonBody(req),
      action = requireText(body.action, { maxLen: 64 }),
      p = (body.payload && typeof body.payload === "object"
        ? body.payload
        : {}) as Record<string, unknown>;
    const enrich = async (rows: any[]) => {
      const ids = [
        ...new Set(rows.map((r) =>
          r.workspace_id
        )),
      ];
      const { data: ws } = ids.length
        ? await admin.from("workspaces").select(
          "id,name,primary_admin_profile_id",
        ).in("id", ids)
        : { data: [] };
      const map = new Map((ws ?? []).map((w: any) => [w.id, w]));
      return rows.map((r) => ({
        ...r,
        workspace_name: map.get(r.workspace_id)?.name ?? null,
        is_primary_admin:
          map.get(r.workspace_id)?.primary_admin_profile_id === r.id,
      }));
    };
    const tenantAccountFields =
      "id,workspace_id,auth_email,role,is_active,deleted_at,created_at";
    const enrichTenantAccounts = async (rows: any[]): Promise<TenantAccount[]> =>
      (await enrich(rows)).map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        workspace_name: row.workspace_name,
        auth_email: row.auth_email ?? "",
        role: "tenant_account",
        is_active: row.is_active !== false,
        deleted_at: row.deleted_at ?? null,
        created_at: row.created_at,
      }));
    const resetRedirect = () => {
      const redirect = (Deno.env.get("ITX_PASSWORD_RESET_REDIRECT_URL") ?? "").trim();
      if (!redirect) throw new ValidationError("Password reset redirect is not configured.", 500);
      return redirect;
    };
    const tenantAccounts: TenantAccountRepository = {
      list: async ({ workspaceId, search }) => {
        let query = admin.from("profiles").select(tenantAccountFields)
          .eq("role", "tenant_account").is("deleted_at", null).order("created_at");
        if (workspaceId) query = query.eq("workspace_id", workspaceId);
        const { data, error } = await query;
        if (error) throw error;
        let rows = await enrichTenantAccounts(data ?? []);
        if (search) {
          rows = rows.filter((row) =>
            row.auth_email.toLowerCase().includes(search) ||
            row.workspace_name?.toLowerCase().includes(search)
          );
        }
        return rows;
      },
      create: async (workspaceId, email) => {
        // Validate email delivery configuration before creating either record so
        // a configuration error cannot leave an orphaned Auth user/profile.
        const redirectTo = resetRedirect();
        const { data: workspace } = await admin.from("workspaces").select("id")
          .eq("id", workspaceId).maybeSingle();
        if (!workspace) throw new ValidationError("Workspace not found.", 404);
        const userId = crypto.randomUUID();
        const { error: profileError } = await admin.from("profiles").insert({
          id: userId,
          workspace_id: workspaceId,
          auth_email: email,
          role: "tenant_account",
          is_active: true,
        });
        if (profileError) throw new ValidationError("Unable to create Tenant Account.");
        let created: { user: { betterAuthUserId: string } };
        try {
          created = await callBetterAuthAdmin<{user:{betterAuthUserId:string}}>({action:"create_user",profileId:userId,email,password:password(),role:"user",profileRole:"tenant_account",workspaceId});
        } catch {
          await admin.from("profiles").delete().eq("id", userId);
          throw new ValidationError("Unable to create Tenant Account.");
        }
        const { data, error } = await admin.from("profiles").select(tenantAccountFields)
          .eq("id", userId).single();
        if (error || !data) {
          await admin.from("profiles").delete().eq("id", userId);
          await callBetterAuthAdmin({action:"delete_user",profileId:userId,betterAuthUserId:created.user.betterAuthUserId}).catch(()=>undefined);
          throw new ValidationError("Unable to create Tenant Account.");
        }
        try { await callBetterAuthAdmin({action:"request_password_reset",profileId:userId,redirectTo}); } catch {
          await admin.from("profiles").delete().eq("id", userId);
          await callBetterAuthAdmin({action:"delete_user",profileId:userId,betterAuthUserId:created.user.betterAuthUserId}).catch(()=>undefined);
          throw new ValidationError("Unable to send Tenant Account setup email.");
        }
        return (await enrichTenantAccounts([data]))[0];
      },
      findActive: async (id) => {
        const { data, error } = await admin.from("profiles").select(tenantAccountFields)
          .eq("id", id).eq("role", "tenant_account").is("deleted_at", null)
          .maybeSingle();
        if (error) throw error;
        return data ? (await enrichTenantAccounts([data]))[0] : null;
      },
      setStatus: async (id, isActive) => {
        const { data, error } = await admin.from("profiles").update({ is_active: isActive })
          .eq("id", id).eq("role", "tenant_account").is("deleted_at", null)
          .select(tenantAccountFields).single();
        if (error || !data) throw new ValidationError("Unable to update Tenant Account.");
        return (await enrichTenantAccounts([data]))[0];
      },
      updateEmail: async (id, email) => {
        await callBetterAuthAdmin({action:"update_email",profileId:id,email});
        const { data, error } = await admin.from("profiles").update({ auth_email: email })
          .eq("id", id).eq("role", "tenant_account").is("deleted_at", null)
          .select(tenantAccountFields).single();
        if (error || !data) throw new ValidationError("Unable to update Tenant Account.");
        return (await enrichTenantAccounts([data]))[0];
      },
      sendReset: async (email) => {
        resetRedirect();
        const { data: target } = await admin.from("profiles").select("id").eq("auth_email",email).eq("role","tenant_account").maybeSingle();
        if (!target?.id) throw new ValidationError("Tenant Account not found.",404);
        await callBetterAuthAdmin({action:"request_password_reset",profileId:target.id,redirectTo:resetRedirect()});
      },
      softDelete: async (id, at) => {
        const { error } = await admin.from("profiles").update({
          deleted_at: at,
          is_active: false,
        }).eq("id", id).eq("role", "tenant_account").is("deleted_at", null);
        if (error) throw new ValidationError("Unable to remove Tenant Account.");
      },
      revokeSessions: async (id, actorId, at) => {
        const { error } = await admin.from("account_sessions").update({
          revoked_at: at,
          revoked_by: actorId,
        }).eq("profile_id", id).is("revoked_at", null);
        if (error) throw new ValidationError("Unable to revoke Tenant Account sessions.");
      },
      audit: async (actionType, id, metadata) => {
        await writeSuperAdminAudit(admin, {
          actorId: user.id,
          actorEmail: user.email ?? null,
          actionType,
          targetType: "tenant_account",
          targetId: id,
          metadata,
        });
      },
    };
    const tenantAccountResult = await handleTenantAccountAction(action, p, {
      actorId: user.id,
      now: () => new Date().toISOString(),
      repository: tenantAccounts,
    });
    if (tenantAccountResult.handled) {
      return tenantAccountResult.error
        ? json(tenantAccountResult.status, { error: tenantAccountResult.error })
        : json(tenantAccountResult.status, { data: tenantAccountResult.data });
    }
    if (action === "list_super_admins") {
      const search = optionalText(p.search, { maxLen: 120 }).toLowerCase();
      const { data, error } = await admin.from("profiles").select("id,auth_email,role,is_active,created_at").eq("role", "super_admin").order("created_at");
      if (error) throw error;
      return json(200, { data: (data ?? []).filter((row: any) => !search || row.auth_email?.toLowerCase().includes(search)) });
    }
    if (action === "create_super_admin") {
      const email = requireEmail(p.auth_email), temporaryPassword = requireText(p.password, { maxLen: 1024 });
      const profileId=crypto.randomUUID();
      const { error: profileError } = await admin.from("profiles").insert({ id: profileId, workspace_id: null, auth_email: email, role: "super_admin", is_active: true });
      if (profileError) return json(400, { error: "Unable to create Super Admin." });
      let created:{user:{betterAuthUserId:string}};
      try {
        created=await callBetterAuthAdmin({action:"create_user",profileId,email,password:temporaryPassword,role:"super_admin",profileRole:"super_admin"});
      } catch {
        await admin.from("profiles").delete().eq("id", profileId);
        return json(400,{error:"Unable to create Super Admin."});
      }
      const { data, error } = await admin.from("profiles").select("id,auth_email,role,is_active,created_at").eq("id", profileId).single();
      if (error || !data) {
        await admin.from("profiles").delete().eq("id", profileId);
        await callBetterAuthAdmin({action:"delete_user",profileId,betterAuthUserId:created.user.betterAuthUserId}).catch(()=>undefined);
        return json(400, { error: "Unable to create Super Admin." });
      }
      await writeSuperAdminAudit(admin, {
        actorId: user.id,
        actorEmail: user.email ?? null,
        actionType: "create_super_admin",
        targetType: "super_admin",
        targetId: profileId,
        metadata: { auth_email: email },
      });
      return json(200, { data });
    }
    if (action === "send_super_admin_reset") {
      const email = requireEmail(p.auth_email), redirect = (Deno.env.get("ITX_PASSWORD_RESET_REDIRECT_URL") ?? "").trim();
      if (!redirect) return json(500, { error: "Password reset redirect is not configured." });
      const {data:target}=await admin.from("profiles").select("id").eq("auth_email",email).eq("role","super_admin").maybeSingle();if(!target?.id)return json(404,{error:"Super Admin not found."});
      try{await callBetterAuthAdmin({action:"request_password_reset",profileId:target.id,redirectTo:redirect});}catch{return json(400,{error:"Unable to send reset."});}
      await writeSuperAdminAudit(admin, {
        actorId: user.id,
        actorEmail: user.email ?? null,
        actionType: "send_super_admin_reset",
        targetType: "super_admin",
        targetId: email,
        metadata: {},
      });
      return json(200, { data: { success: true } });
    }
    if (action === "set_super_admin_status" || action === "update_super_admin_email") {
      const id = requireUuid(p.id);
      if (action === "set_super_admin_status") {
        if (id === user.id && p.is_active === false) return json(400, { error: "You cannot suspend your own account." });
        if (typeof p.is_active !== "boolean") return json(400, { error: "Invalid request" });
        const { data, error } = await admin.from("profiles").update({ is_active: p.is_active }).eq("id", id).eq("role", "super_admin").select("id,auth_email,role,is_active,created_at").single();
        if (error || !data) return json(400, { error: "Unable to update Super Admin." });
        await writeSuperAdminAudit(admin, {
          actorId: user.id,
          actorEmail: user.email ?? null,
          actionType: "set_super_admin_status",
          targetType: "super_admin",
          targetId: id,
          metadata: { is_active: p.is_active },
        });
        return json(200, { data });
      }
      const email = requireEmail(p.auth_email); try{await callBetterAuthAdmin({action:"update_email",profileId:id,email});}catch{return json(400,{error:"Unable to update email."});}
      const { data, error } = await admin.from("profiles").update({ auth_email: email }).eq("id", id).eq("role", "super_admin").select("id,auth_email,role,is_active,created_at").single();
      if (error || !data) return json(400, { error: "Unable to update Super Admin." });
      await writeSuperAdminAudit(admin, {
        actorId: user.id,
        actorEmail: user.email ?? null,
        actionType: "update_super_admin_email",
        targetType: "super_admin",
        targetId: id,
        metadata: { auth_email: email },
      });
      return json(200, { data });
    }
    if (action === "list_workspace_admins") {
      const search = optionalText(p.search, { maxLen: 120 }).toLowerCase(),
        wid = optionalText(p.workspace_id, { maxLen: 36 });
      let q = admin.from("profiles").select(
        "id,workspace_id,auth_email,role,is_active,deleted_at,created_at",
      ).eq("role", "workspace_admin").is("deleted_at", null).order(
        "created_at",
      );
      if (wid && wid !== "all") q = q.eq("workspace_id", requireUuid(wid));
      const { data, error } = await q;
      if (error) throw error;
      let rows = await enrich(data ?? []);
      if (search) {
        rows = rows.filter((r) =>
          r.auth_email?.toLowerCase().includes(search) ||
          r.workspace_name?.toLowerCase().includes(search)
        );
      }
      return json(200, { data: rows });
    }
    if (action === "create_workspace_admin") {
      const workspaceId = requireUuid(p.workspace_id), email = requireEmail(p.auth_email), profileId=crypto.randomUUID();
      const { error: profileError } = await admin.from("profiles").insert({
        id: profileId,
        workspace_id: workspaceId,
        auth_email: email,
        role: "workspace_admin",
        is_active: true,
      });
      if (profileError) return json(400, { error: "Unable to create Workspace Admin." });
      let created:{user:{betterAuthUserId:string}};
      try {
        created=await callBetterAuthAdmin({action:"create_user",profileId,email,password:password(),role:"user",profileRole:"workspace_admin",workspaceId});
      } catch {
        await admin.from("profiles").delete().eq("id", profileId);
        return json(400,{error:"Unable to create Workspace Admin."});
      }
      const { data, error } = await admin.from("profiles").select(
        "id,workspace_id,auth_email,role,is_active,deleted_at,created_at",
      ).eq("id", profileId).single();
      if (error || !data) {
        await admin.from("profiles").delete().eq("id", profileId);
        await callBetterAuthAdmin({action:"delete_user",profileId,betterAuthUserId:created.user.betterAuthUserId}).catch(()=>undefined);
        return json(400, { error: "Unable to create Workspace Admin." });
      }
      await writeSuperAdminAudit(admin, {
        actorId: user.id,
        actorEmail: user.email ?? null,
        actionType: "create_workspace_admin",
        targetType: "workspace_admin",
        targetId: profileId,
        metadata: { workspace_id: workspaceId, auth_email: email },
      });
      return json(200, { data: (await enrich([data]))[0] });
    }
    const id = requireUuid(p.id);
    const { data: target } = await admin.from("profiles").select(
      "id,workspace_id,auth_email",
    ).eq("id", id).eq("role", "workspace_admin").is("deleted_at", null)
      .maybeSingle();
    if (!target) return json(404, { error: "Workspace Admin not found." });
    const { data: w } = await admin.from("workspaces").select(
      "primary_admin_profile_id",
    ).eq("id", target.workspace_id).maybeSingle();
    if (action === "set_workspace_admin_status") {
      if (w?.primary_admin_profile_id === id) {
        return json(400, {
          error: "Primary Workspace Admin cannot be suspended.",
        });
      }
      if (typeof p.is_active !== "boolean") {
        return json(400, { error: "Invalid request" });
      }
      const { data, error } = await admin.from("profiles").update({
        is_active: p.is_active,
      }).eq("id", id).select(
        "id,workspace_id,auth_email,role,is_active,deleted_at,created_at",
      ).single();
      if (error || !data) return json(400, { error: "Unable to update Workspace Admin." });
      await writeSuperAdminAudit(admin, {
        actorId: user.id,
        actorEmail: user.email ?? null,
        actionType: "set_workspace_admin_status",
        targetType: "workspace_admin",
        targetId: id,
        metadata: { workspace_id: target.workspace_id, is_active: p.is_active },
      });
      return json(200, { data: (await enrich([data]))[0] });
    }
    if (action === "update_workspace_admin_email") {
      const email = requireEmail(p.auth_email);
      try{await callBetterAuthAdmin({action:"update_email",profileId:id,email});}catch{return json(400,{error:"Unable to update email."});}
      const { data, error } = await admin.from("profiles").update({
        auth_email: email,
      }).eq("id", id).select(
        "id,workspace_id,auth_email,role,is_active,deleted_at,created_at",
      ).single();
      if (error || !data) return json(400, { error: "Unable to update Workspace Admin." });
      await writeSuperAdminAudit(admin, {
        actorId: user.id,
        actorEmail: user.email ?? null,
        actionType: "update_workspace_admin_email",
        targetType: "workspace_admin",
        targetId: id,
        metadata: { workspace_id: target.workspace_id, auth_email: email },
      });
      return json(200, { data: (await enrich([data]))[0] });
    }
    if (action === "send_workspace_admin_reset") {
      const redirect = (Deno.env.get("ITX_PASSWORD_RESET_REDIRECT_URL") ?? "")
        .trim();
      if (!redirect) {
        return json(500, {
          error: "Password reset redirect is not configured.",
        });
      }
      try{await callBetterAuthAdmin({action:"request_password_reset",profileId:id,redirectTo:redirect});}catch{return json(400,{error:"Unable to send reset."});}
      await writeSuperAdminAudit(admin, {
        actorId: user.id,
        actorEmail: user.email ?? null,
        actionType: "send_workspace_admin_reset",
        targetType: "workspace_admin",
        targetId: id,
        metadata: { workspace_id: target.workspace_id },
      });
      return json(200, { data: { success: true } });
    }
    return json(400, { error: "Invalid action" });
  } catch (e) {
    if (e instanceof ValidationError) {
      return json(e.status, { error: e.message });
    }
    console.error(e);
    return json(500, { error: "Request failed" });
  }
});
