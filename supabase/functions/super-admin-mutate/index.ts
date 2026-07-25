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
      url = Deno.env.get("ITX_SUPABASE_URL"),
      key = Deno.env.get("ITX_PUBLISHABLE_KEY"),
      secret = Deno.env.get("ITX_SECRET_KEY");
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
