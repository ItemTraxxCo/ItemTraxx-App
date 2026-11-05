import { serve } from "../_shared/serve.ts";
import { getExternalAuthUser } from "../_shared/externalAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { isAccountTokenBlockedBySessionRevocation } from "../_shared/accountSessions.ts";
import { isSuperAdminTokenBlockedBySessionRevocation } from "../_shared/superAdminSessions.ts";
import { getRequestId } from "../_shared/observability.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { ValidationError } from "../_shared/validation.ts";
import {
  normalizeClientIp,
  normalizeUserAgent,
  parseAcceptLegalDocumentRequest,
} from "../_shared/legalAcceptance.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));
  const originAllowed = !origin || isAllowedOrigin(origin, allowedOrigins);
  const headers = origin && originAllowed
    ? { ...corsHeaders, "Access-Control-Allow-Origin": origin }
    : corsHeaders;
  return { originAllowed, headers };
};

const parseAuthToken = (req: Request) =>
  req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim() ?? "";

serve(async (req) => {
  const { originAllowed, headers } = resolveCorsHeaders(req);
  const requestId = getRequestId(req);
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: status < 400, ...body }), {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
    });

  if (req.method === "OPTIONS") {
    return originAllowed
      ? new Response("ok", { headers })
      : new Response("Origin not allowed", { status: 403, headers });
  }
  if (!originAllowed) return jsonResponse(403, { error: "Origin not allowed" });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  const ingressError = await requireTrustedEdgeIngress(req, "legal-acceptance", jsonResponse);
  if (ingressError) return ingressError;

  const supabaseUrl = (Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL"))?.trim();
  const publishableKey = (Deno.env.get("ITX_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))?.trim();
  const serviceKey = (Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))?.trim();
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return jsonResponse(500, { error: "Server misconfiguration." });
  }

  const accessToken = parseAuthToken(req);
  if (!accessToken) return jsonResponse(401, { error: "Authentication required." });

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await getExternalAuthUser(authClient, accessToken);
  if (error || !data.user?.id) {
    return jsonResponse(401, { error: "Authentication required." });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody<Record<string, unknown>>(req, 4 * 1024);
  } catch (readError) {
    if (readError instanceof ValidationError) {
      return jsonResponse(readError.status, { error: readError.message });
    }
    return jsonResponse(400, { error: "Invalid request" });
  }
  const action = body.action;
  if (action !== "status" && action !== "accept") {
    return jsonResponse(400, { error: "Invalid request" });
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role, workspace_id, is_active, deleted_at")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError) return jsonResponse(503, { error: "Account status unavailable." });
    if (!profile || profile.is_active !== true || profile.deleted_at) {
      return jsonResponse(403, { error: "Account access denied." });
    }

    const revocation = profile.role === "super_admin"
      ? await isSuperAdminTokenBlockedBySessionRevocation(adminClient, {
        profileId: data.user.id,
        authToken: accessToken,
      })
      : await isAccountTokenBlockedBySessionRevocation(adminClient, {
        workspaceId: profile.workspace_id ?? "",
        profileId: data.user.id,
        authToken: accessToken,
      });
    if (revocation.relationMissing) {
      return jsonResponse(503, { error: "Session controls unavailable." });
    }
    if (revocation.blocked) return jsonResponse(401, { error: "Session revoked." });

    if (action === "status") {
      const { data: pending, error: pendingError } = await adminClient.rpc(
        "list_pending_legal_acceptances",
        { p_profile_id: data.user.id },
      );
      if (pendingError) return jsonResponse(503, { error: "Legal document status unavailable." });
      return jsonResponse(200, { data: { pending: pending ?? [] } });
    }

    const accept = parseAcceptLegalDocumentRequest(body);
    if (!accept) return jsonResponse(400, { error: "Invalid request" });

    // IP and user agent are taken from the trusted edge request, never from
    // the client body, so the audit record cannot be forged by the signer.
    const { data: recorded, error: recordError } = await adminClient.rpc(
      "record_legal_acceptance",
      {
        p_profile_id: data.user.id,
        p_document_type: accept.documentType,
        p_document_version: accept.documentVersion,
        p_document_hash: accept.documentHash,
        p_ip_address: normalizeClientIp(req.headers.get("cf-connecting-ip")),
        p_user_agent: normalizeUserAgent(req.headers.get("user-agent")),
        p_acceptance_method: "clickwrap",
      },
    );
    if (recordError) {
      // 22023 = unknown/retired version or hash mismatch; 42501 = not applicable.
      const code = (recordError as { code?: string }).code;
      if (code === "22023") return jsonResponse(409, { error: "Document version is not current." });
      if (code === "42501") return jsonResponse(403, { error: "Document does not apply to this account." });
      return jsonResponse(503, { error: "Unable to record acceptance." });
    }
    return jsonResponse(200, { data: recorded });
  } catch {
    return jsonResponse(500, { error: "Request failed." });
  }
});
