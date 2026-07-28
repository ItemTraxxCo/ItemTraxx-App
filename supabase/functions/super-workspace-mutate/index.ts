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
  SLUG_PATTERN,
  ValidationError,
} from "../_shared/validation.ts";
const corsBase = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
const randomPassword = () => `${crypto.randomUUID()}-Aa1!`;
const ACCOUNT_CATEGORIES = new Set(["workspace", "education", "custom", "individual"]);
const PLAN_CODES = new Set([
  "workspace_core",
  "workspace_growth",
  "workspace_enterprise",
  "education",
  "custom",
  "individual_yearly",
  "individual_monthly",
]);
const BILLING_STATUSES = new Set(["draft", "active", "past_due", "canceled"]);
const defaultFeatureFlags = () => ({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_borrower_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});
const normalizeFeatureFlags = (value: unknown) => {
  const input = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(
    Object.keys(defaultFeatureFlags()).map((key) => [key, input[key] !== false]),
  );
};
const policyValues = (p: Record<string, unknown>) => {
  const category = ACCOUNT_CATEGORIES.has(String(p.account_category))
    ? String(p.account_category)
    : "workspace";
  const plan = optionalText(p.plan_code, { maxLen: 40 }) || null;
  if (plan && !PLAN_CODES.has(plan)) throw new ValidationError("Invalid workspace plan.");
  const planMatchesCategory = !plan ||
    (category === "individual" && ["individual_yearly", "individual_monthly"].includes(plan)) ||
    (category === "workspace" && ["workspace_core", "workspace_growth", "workspace_enterprise"].includes(plan)) ||
    (category === "education" && plan === "education") ||
    (category === "custom" && plan === "custom");
  if (!planMatchesCategory) throw new ValidationError("Invalid plan for workspace account category.");
  const checkoutHours = Number(p.checkout_due_hours ?? 72);
  if (!Number.isInteger(checkoutHours) || checkoutHours < 1 || checkoutHours > 720) {
    throw new ValidationError("Checkout due limit must be between 1 and 720 hours.");
  }
  const billingStatus = optionalText(p.billing_status, { maxLen: 20 }) || null;
  if (billingStatus && !BILLING_STATUSES.has(billingStatus)) {
    throw new ValidationError("Invalid billing status.");
  }
  return {
    account_category: category,
    plan_code: plan,
    checkout_due_hours: checkoutHours,
    feature_flags: normalizeFeatureFlags(p.feature_flags),
    contact_name: optionalText(p.contact_name, { maxLen: 120 }) || null,
    support_email: optionalText(p.support_email, { maxLen: 254 }) || null,
    billing_email: optionalText(p.billing_email, { maxLen: 254 }) || null,
    billing_status: billingStatus,
    renewal_date: optionalText(p.renewal_date, { maxLen: 10 }) || null,
    invoice_reference: optionalText(p.invoice_reference, { maxLen: 120 }) || null,
  };
};
export const SUPER_WORKSPACE_ACTIONS = [
  "list_workspaces",
  "create_workspace",
  "update_workspace",
  "set_workspace_status",
  "send_primary_admin_reset",
  "set_primary_admin",
] as const;
serve(async (req) => {
  const origin = req.headers.get("origin"),
    allowed = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS")),
    originAllowed = !origin || isAllowedOrigin(origin, allowed),
    headers = {
      ...corsBase,
      ...(origin && originAllowed
        ? { "Access-Control-Allow-Origin": origin }
        : {}),
    };
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: status < 400, ...body }), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") {
    return originAllowed
      ? new Response("ok", { headers })
      : new Response("Origin not allowed", { status: 403, headers });
  }
  if (!originAllowed) return json(403, { error: "Origin not allowed" });
  const ingress = await requireTrustedEdgeIngress(
    req,
    "super-workspace-mutate",
    json,
  );
  if (ingress) return ingress;
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const token = authHeader.replace(/^Bearer\s+/i, "").trim(),
      url = Deno.env.get("ITX_SUPABASE_URL"),
      publishable = Deno.env.get("ITX_PUBLISHABLE_KEY"),
      service = Deno.env.get("ITX_SECRET_KEY");
    if (!url || !publishable || !service) {
      return json(500, { error: "Server misconfiguration" });
    }
    const userClient = createClient(url, publishable, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }),
      admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(401, { error: "Unauthorized" });
    const { data: profile } = await admin.from("profiles").select(
      "role,is_active",
    ).eq("id", user.id).maybeSingle();
    if (profile?.role !== "super_admin" || profile.is_active === false) {
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
    const writeAudit = async (actionType: string, workspaceId: string, metadata: Record<string, unknown> = {}) => {
      const { error } = await admin.from("admin_audit_logs").insert({
        workspace_id: workspaceId,
        actor_id: user.id,
        action_type: actionType,
        entity_type: "workspace",
        entity_id: workspaceId,
        metadata,
      });
      if (error) console.error("super-workspace-mutate audit failed", error);
    };
    const load = async (id?: string) => {
      let q = admin.from("workspaces").select(
        "id,name,slug,status,primary_admin_profile_id,archived_at,purge_after,purge_state,created_at,workspace_policies(account_category,plan_code,checkout_due_hours,feature_flags,contact_name,support_email,billing_email,billing_status,renewal_date,invoice_reference)",
      ).order("created_at", { ascending: false });
      if (id) {
        q = q.eq("id", id);
      }
      const { data, error } = await q;
      if (error) {
        throw error;
      }
      const rows = data ?? [];
      const primaryIds = rows.map((r: any) =>
        r.primary_admin_profile_id
      )
        .filter(Boolean);
      const { data: profiles } = primaryIds.length
        ? await admin.from("profiles").select("id,auth_email").in(
          "id",
          primaryIds,
        )
        : { data: [] };
      const emails = new Map(
        (profiles ?? []).map((x: any) => [x.id, x.auth_email]),
      );
      return rows.map((r: any) => ({
        ...r,
        primary_admin_email: emails.get(r.primary_admin_profile_id) ?? null,
        ...(Array.isArray(r.workspace_policies)
          ? r.workspace_policies[0]
          : r.workspace_policies),
      }));
    };
    if (action === "list_workspaces") {
      const search = optionalText(p.search, { maxLen: 120 }).toLowerCase(),
        status = optionalText(p.status, { maxLen: 20 });
      let rows = await load();
      if (search) {
        rows = rows.filter((r: any) =>
          r.name.toLowerCase().includes(search) || r.slug.includes(search)
        );
      }
      if (status && status !== "all") {
        rows = rows.filter((r: any) =>
          status === "archived"
            ? !!r.archived_at
            : r.status === status && !r.archived_at
        );
      }
      return json(200, { data: rows });
    }
    if (action === "create_workspace") {
      const name = requireText(p.name, { maxLen: 120 }),
        slug = requireText(p.slug, {
          maxLen: 63,
          pattern: SLUG_PATTERN,
          transform: "lowercase",
        }),
        email = requireEmail(p.auth_email),
        policy = policyValues(p);
      const { data: w, error } = await admin.from("workspaces").insert({
        name,
        slug,
        status: "active",
      }).select("id").single();
      if (error || !w) {
        return json(400, { error: "Unable to create workspace." });
      }
      const created = await admin.auth.admin.createUser({
        email,
        password: typeof p.password === "string" && p.password
          ? p.password
          : randomPassword(),
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        await admin.from("workspaces").delete().eq("id", w.id);
        return json(400, { error: "Unable to create primary admin." });
      }
      const { error: pe } = await admin.from("profiles").insert({
        id: created.data.user.id,
        workspace_id: w.id,
        role: "workspace_admin",
        auth_email: email,
        is_active: true,
      });
      if (pe) {
        await admin.auth.admin.deleteUser(created.data.user.id);
        await admin.from("workspaces").delete().eq("id", w.id);
        return json(400, { error: "Unable to create workspace." });
      }
      await admin.from("workspaces").update({
        primary_admin_profile_id: created.data.user.id,
      }).eq("id", w.id);
      const { error: policyError } = await admin.from("workspace_policies").upsert({
        workspace_id: w.id,
        ...policy,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      });
      if (policyError) {
        await admin.auth.admin.deleteUser(created.data.user.id);
        await admin.from("workspaces").delete().eq("id", w.id);
        return json(400, { error: "Unable to create workspace settings." });
      }
      await writeAudit("create_workspace", w.id, { name, slug, account_category: policy.account_category });
      return json(200, { data: (await load(w.id))[0] });
    }
    if (action === "update_workspace") {
      const id = requireUuid(p.id),
        name = requireText(p.name, { maxLen: 120 }),
        slug = requireText(p.slug, {
          maxLen: 63,
          pattern: SLUG_PATTERN,
          transform: "lowercase",
        });
      const { error } = await admin.from("workspaces").update({ name, slug })
        .eq("id", id);
      if (error) return json(400, { error: "Unable to update workspace." });
      const policy = policyValues(p);
      const { error: policyError } = await admin.from("workspace_policies").upsert({
        workspace_id: id,
        ...policy,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      });
      if (policyError) return json(400, { error: "Unable to update workspace settings." });
      await writeAudit("update_workspace", id, { name, slug, account_category: policy.account_category });
      return json(200, { data: (await load(id))[0] });
    }
    if (action === "set_workspace_status") {
      const id = requireUuid(p.id),
        status = requireText(p.status, { maxLen: 20 }),
        now = new Date().toISOString();
      const values = status === "archived"
        ? {
          status: "suspended",
          archived_at: now,
          purge_after: new Date(Date.now() + 30 * 86400000).toISOString(),
          purge_state: "grace",
        }
        : {
          status: status === "active" ? "active" : "suspended",
          archived_at: null,
          purge_after: null,
          purge_state: "none",
        };
      const { error } = await admin.from("workspaces").update(values).eq(
        "id",
        id,
      );
      if (error) {
        return json(400, { error: "Unable to update workspace status." });
      }
      await writeAudit("set_workspace_status", id, { status });
      return json(200, { data: (await load(id))[0] });
    }
    if (action === "set_primary_admin") {
      const workspaceId = requireUuid(p.workspace_id),
        profileId = requireUuid(p.profile_id);
      const { data: target } = await admin.from("profiles").select("id").eq(
        "id",
        profileId,
      ).eq("workspace_id", workspaceId).eq("role", "workspace_admin").eq(
        "is_active",
        true,
      ).is("deleted_at", null).maybeSingle();
      if (!target) return json(400, { error: "Invalid Workspace Admin." });
      const { error } = await admin.from("workspaces").update({
        primary_admin_profile_id: profileId,
      }).eq("id", workspaceId);
      if (error) return json(400, { error: "Unable to reassign Primary Workspace Admin." });
      await writeAudit("set_primary_admin", workspaceId, { profile_id: profileId });
      return json(200, { data: (await load(workspaceId))[0] });
    }
    if (action === "send_primary_admin_reset") {
      const workspaceId = requireUuid(p.workspace_id),
        row = (await load(workspaceId))[0];
      if (!row?.primary_admin_email) {
        return json(404, { error: "Primary admin not found." });
      }
      const redirect = (Deno.env.get("ITX_PASSWORD_RESET_REDIRECT_URL") ?? "")
        .trim();
      if (!redirect) {
        return json(500, {
          error: "Password reset redirect is not configured.",
        });
      }
      const { error } = await admin.auth.resetPasswordForEmail(
        row.primary_admin_email,
        { redirectTo: redirect },
      );
      if (error) return json(400, { error: "Unable to send password reset." });
      await writeAudit("send_primary_admin_reset", workspaceId, {});
      return json(200, {
        data: { success: true, auth_email: row.primary_admin_email },
      });
    }
    return json(400, { error: "Invalid action" });
  } catch (error) {
    if (error instanceof ValidationError) {
      return json(error.status, { error: error.message });
    }
    console.error("super-workspace-mutate failed", error);
    return json(500, { error: "Request failed" });
  }
});
