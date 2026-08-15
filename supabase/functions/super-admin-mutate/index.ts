import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { hasPrivilegedStepUp } from "../_shared/privilegedStepUp.ts";
import { isSuperAdminTokenBlockedBySessionRevocation } from "../_shared/superAdminSessions.ts";
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
      { data: { user } } = await uc.auth.getUser();
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
        const created = await admin.auth.admin.createUser({
          email,
          password: password(),
          email_confirm: true,
        });
        if (created.error || !created.data.user) {
          throw new ValidationError("Unable to create Tenant Account.");
        }
        const userId = created.data.user.id;
        const { data, error } = await admin.from("profiles").insert({
          id: userId,
          workspace_id: workspaceId,
          auth_email: email,
          role: "tenant_account",
          is_active: true,
        }).select(tenantAccountFields).single();
        if (error || !data) {
          await admin.auth.admin.deleteUser(userId);
          throw new ValidationError("Unable to create Tenant Account.");
        }
        const reset = await admin.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (reset.error) {
          await admin.from("profiles").delete().eq("id", userId);
          await admin.auth.admin.deleteUser(userId);
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
        const authUpdate = await admin.auth.admin.updateUserById(id, {
          email,
          email_confirm: true,
        });
        if (authUpdate.error) throw new ValidationError("Unable to update email.");
        const { data, error } = await admin.from("profiles").update({ auth_email: email })
          .eq("id", id).eq("role", "tenant_account").is("deleted_at", null)
          .select(tenantAccountFields).single();
        if (error || !data) throw new ValidationError("Unable to update Tenant Account.");
        return (await enrichTenantAccounts([data]))[0];
      },
      sendReset: async (email) => {
        const { error } = await admin.auth.resetPasswordForEmail(email, {
          redirectTo: resetRedirect(),
        });
        if (error) throw new ValidationError("Unable to send password reset.");
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
        const { error } = await admin.from("super_admin_audit_logs").insert({
          actor_id: user.id,
          actor_email: user.email ?? null,
          action_type: actionType,
          target_type: "tenant_account",
          target_id: id,
          metadata,
        });
        if (error) throw new Error("Unable to write Super Admin audit log.");
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
      const created = await admin.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true });
      if (created.error || !created.data.user) return json(400, { error: "Unable to create Super Admin." });
      const { data, error } = await admin.from("profiles").insert({ id: created.data.user.id, workspace_id: null, auth_email: email, role: "super_admin", is_active: true }).select("id,auth_email,role,is_active,created_at").single();
      if (error) { await admin.auth.admin.deleteUser(created.data.user.id); return json(400, { error: "Unable to create Super Admin." }); }
      return json(200, { data });
    }
    if (action === "send_super_admin_reset") {
      const email = requireEmail(p.auth_email), redirect = (Deno.env.get("ITX_PASSWORD_RESET_REDIRECT_URL") ?? "").trim();
      if (!redirect) return json(500, { error: "Password reset redirect is not configured." });
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: redirect });
      return error ? json(400, { error: "Unable to send reset." }) : json(200, { data: { success: true } });
    }
    if (action === "set_super_admin_status" || action === "update_super_admin_email") {
      const id = requireUuid(p.id);
      if (action === "set_super_admin_status") {
        if (id === user.id && p.is_active === false) return json(400, { error: "You cannot suspend your own account." });
        if (typeof p.is_active !== "boolean") return json(400, { error: "Invalid request" });
        const { data, error } = await admin.from("profiles").update({ is_active: p.is_active }).eq("id", id).eq("role", "super_admin").select("id,auth_email,role,is_active,created_at").single();
        return error ? json(400, { error: "Unable to update Super Admin." }) : json(200, { data });
      }
      const email = requireEmail(p.auth_email); const authUpdate = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
      if (authUpdate.error) return json(400, { error: "Unable to update email." });
      const { data, error } = await admin.from("profiles").update({ auth_email: email }).eq("id", id).eq("role", "super_admin").select("id,auth_email,role,is_active,created_at").single();
      return error ? json(400, { error: "Unable to update Super Admin." }) : json(200, { data });
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
      const workspaceId = requireUuid(p.workspace_id),
        email = requireEmail(p.auth_email),
        created = await admin.auth.admin.createUser({
          email,
          password: password(),
          email_confirm: true,
        });
      if (created.error || !created.data.user) {
        return json(400, { error: "Unable to create Workspace Admin." });
      }
      const { data, error } = await admin.from("profiles").insert({
        id: created.data.user.id,
        workspace_id: workspaceId,
        auth_email: email,
        role: "workspace_admin",
        is_active: true,
      }).select(
        "id,workspace_id,auth_email,role,is_active,deleted_at,created_at",
      ).single();
      if (error) {
        await admin.auth.admin.deleteUser(created.data.user.id);
        return json(400, { error: "Unable to create Workspace Admin." });
      }
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
      const { data } = await admin.from("profiles").update({
        is_active: p.is_active,
      }).eq("id", id).select(
        "id,workspace_id,auth_email,role,is_active,deleted_at,created_at",
      ).single();
      return json(200, { data: (await enrich([data]))[0] });
    }
    if (action === "update_workspace_admin_email") {
      const email = requireEmail(p.auth_email);
      const ae = await admin.auth.admin.updateUserById(id, {
        email,
        email_confirm: true,
      });
      if (ae.error) return json(400, { error: "Unable to update email." });
      const { data } = await admin.from("profiles").update({
        auth_email: email,
      }).eq("id", id).select(
        "id,workspace_id,auth_email,role,is_active,deleted_at,created_at",
      ).single();
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
      const { error } = await admin.auth.resetPasswordForEmail(
        target.auth_email,
        { redirectTo: redirect },
      );
      return error
        ? json(400, { error: "Unable to send reset." })
        : json(200, { data: { success: true } });
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
