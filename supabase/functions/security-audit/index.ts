import { serve } from "../_shared/serve.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { getExternalAuthUser } from "../_shared/externalAuth.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import {
  emitIncidentIoSecurityPage,
  getRequestId,
  logError,
} from "../_shared/observability.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { writeSecurityAuditEntries } from "../_shared/securityAudit.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuditRequest = {
  action?: unknown;
  item_ids?: unknown;
};

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));
  const originAllowed = !origin || isAllowedOrigin(origin, allowedOrigins);
  const headers = origin && originAllowed
    ? { ...BASE_CORS_HEADERS, "Access-Control-Allow-Origin": origin }
    : BASE_CORS_HEADERS;
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return originAllowed
      ? new Response("ok", { headers })
      : new Response("Origin not allowed", { status: 403, headers });
  }
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  if (!originAllowed) return jsonResponse(403, { error: "Origin not allowed" });

  const ingressError = await requireTrustedEdgeIngress(req, "security-audit", jsonResponse);
  if (ingressError) return ingressError;

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization) return jsonResponse(401, { error: "Unauthorized" });

  const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return jsonResponse(500, { error: "Server misconfiguration" });
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: authError } = await getExternalAuthUser(
    userClient,
    authorization,
  );
  if (authError || !user) return jsonResponse(401, { error: "Unauthorized" });

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, workspace_id, is_active, deleted_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.workspace_id || profile.is_active === false || profile.deleted_at) {
    return jsonResponse(403, { error: "Access denied" });
  }

  try {
    const payload = await readJsonBody<AuditRequest>(req, 64 * 1024);
    if (
      payload.action !== "read_items" &&
      payload.action !== "read_item_target" &&
      payload.action !== "read_access_grants" &&
      payload.action !== "read_item_activity" &&
      payload.action !== "read_status_history"
    ) {
      return jsonResponse(400, { error: "Invalid audit action" });
    }
    if (!Array.isArray(payload.item_ids) || payload.item_ids.length > 500) {
      return jsonResponse(400, { error: "Invalid item id list" });
    }
    const itemIds = [...new Set(payload.item_ids)];
    if (itemIds.some((id) => typeof id !== "string" || !UUID_RE.test(id))) {
      return jsonResponse(400, { error: "Invalid item id list" });
    }
    if (itemIds.length === 0) return jsonResponse(200, { audited: 0 });

    // Validate every target with the caller's RLS context. The service role is
    // used only to append immutable audit rows after this check succeeds.
    const { data: visibleItems, error: itemError } = await userClient
      .from("items")
      .select("id")
      .eq("workspace_id", profile.workspace_id)
      .in("id", itemIds);
    if (itemError) return jsonResponse(503, { error: "Unable to validate audit targets" });
    const visibleIds = new Set((visibleItems ?? []).map((item: { id: string }) => item.id));
    const visibleTargetIds = itemIds.filter((id) => visibleIds.has(id));
    const deniedTargetIds = itemIds.filter((id) => !visibleIds.has(id));

    const requestId = getRequestId(req);
    const auditAction = payload.action === "read_item_target"
      ? "read_target"
      : payload.action === "read_items"
      ? "read_list"
      : payload.action === "read_access_grants"
      ? "read_access_grants"
      : payload.action === "read_item_activity"
      ? "read_activity"
      : payload.action === "read_status_history"
      ? "read_status_history"
      : "read";
    const auditRoute = payload.action === "read_item_target"
      ? "/rest/v1/items?id-filter"
      : payload.action === "read_access_grants"
      ? "/rest/v1/item_access_grants"
      : payload.action === "read_item_activity"
      ? "/rest/v1/item_logs"
      : payload.action === "read_status_history"
      ? "/rest/v1/item_status_history"
      : "/rest/v1/items";
    const auditBase = {
      actor_id: user.id,
      workspace_id: profile.workspace_id,
      target_type: "item",
      route: auditRoute,
      method: "GET",
      request_id: requestId,
    };
    const visibleAuditWritten = await writeSecurityAuditEntries(
      adminClient,
      visibleTargetIds.map((id) => ({
        ...auditBase,
        action: auditAction,
        target_resource_id: id,
      })),
      { request: req },
    );
    const deniedAuditWritten = await writeSecurityAuditEntries(
      adminClient,
      deniedTargetIds.map((id) => ({
        ...auditBase,
        action: "denied_read_target",
        target_resource_id: id,
      })),
      { request: req },
    );
    if (!visibleAuditWritten || !deniedAuditWritten) {
      logError("security_audit.read_write_failed", requestId, new Error("Audit persistence failed"), {
        error_code: "audit_insert_failed",
      });
      return jsonResponse(503, { error: "Audit persistence unavailable" });
    }
    if (deniedTargetIds.length) {
      emitIncidentIoSecurityPage({
        attackType: "rls_tenant_breach",
        actorId: user.id,
        requestId,
        route: auditRoute,
        request: req,
      });
      return jsonResponse(403, { error: "Access denied" });
    }
    return jsonResponse(200, { audited: itemIds.length });
  } catch (error) {
    const requestId = getRequestId(req);
    if (error instanceof Error && "status" in error && typeof error.status === "number") {
      return jsonResponse(error.status, { error: "Invalid audit request" });
    }
    logError("security_audit.request_failed", requestId, error, { error_code: "audit_request_failed" });
    return jsonResponse(400, { error: "Invalid audit request" });
  }
});
