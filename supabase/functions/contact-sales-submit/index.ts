import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { getRequestId, logError, logInfo } from "../_shared/observability.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { sha256Hex } from "../_shared/sha256.ts";
import {
  enforcePublicRateLimits,
  hashString,
  resolveClientFingerprint,
  resolveClientIp,
  verifyTurnstileToken,
} from "../_shared/preloginGuards.ts";
import { buildPublicRateLimitHeaders } from "../_shared/publicRateLimit.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { resolveEmailAddress, resolveEmailFrom } from "../_shared/emailConfig.ts";
import {
  optionalEnum,
  optionalPositiveInteger,
  optionalText,
  requireEmail,
  requireEnum,
  requireText,
  ValidationError,
} from "../_shared/validation.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const PUBLIC_RATE_LIMIT = {
  limit: 5,
  windowSeconds: 3600,
};
const PUBLIC_GLOBAL_RATE_LIMIT = {
  limit: 120,
  windowSeconds: PUBLIC_RATE_LIMIT.windowSeconds,
};

type ContactPayload = {
  plan?:
    | "workspace_core"
    | "workspace_growth"
    | "workspace_enterprise"
    | "education"
    | "custom"
    | "individual_yearly"
    | "individual_monthly"
    | "other";
  schools_count?: number | null;
  name?: string;
  organization?: string;
  reply_email?: string;
  details?: string;
  turnstile_token?: string;
  website?: string;
  intent?: "sales" | "demo";
};

const normalizeText = (value: unknown, max = 5000) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
};

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const SALES_PLAN_LABELS = {
  workspace_core: "ItemTraxx Workspace Core Plan",
  workspace_growth: "ItemTraxx Workspace Growth Plan",
  workspace_enterprise: "ItemTraxx Workspace Enterprise Plan",
  education: "ItemTraxx Education Plan",
  custom: "ItemTraxx Custom Plan",
  individual_yearly: "ItemTraxx Individual Yearly Plan",
  individual_monthly: "ItemTraxx Individual Monthly Plan",
  other: "Other",
} as const;
type SalesPlanKey = keyof typeof SALES_PLAN_LABELS;
const SALES_PLAN_KEYS = new Set(
  Object.keys(SALES_PLAN_LABELS) as SalesPlanKey[],
);
const CONTACT_INTENTS = new Set(["sales", "demo"] as const);

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(
    Deno.env.get("ITX_ALLOWED_ORIGINS"),
  );

  const hasOrigin = !!origin;
  const originAllowed = !hasOrigin ||
    (hasOrigin && isAllowedOrigin(origin as string, allowedOrigins));

  const headers = hasOrigin && originAllowed
    ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
    : { ...baseCorsHeaders };

  return { hasOrigin, originAllowed, headers };
};

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);
  const requestId = getRequestId(req);

  const jsonResponse = (
    status: number,
    body: Record<string, unknown>,
    rateLimit: {
      retryAfterSeconds?: number | null;
      retry_after_seconds?: number | null;
    } | null = null,
  ) =>
    new Response(JSON.stringify({ ok: status < 400, ...body }), {
      status,
      headers: {
        ...headers,
        ...buildPublicRateLimitHeaders({
          ...PUBLIC_RATE_LIMIT,
          retryAfterSeconds: rateLimit?.retryAfterSeconds ??
            rateLimit?.retry_after_seconds ??
            (status === 429 ? PUBLIC_RATE_LIMIT.windowSeconds : null),
          remaining: status === 429 ? 0 : null,
        }),
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
    });

  if (req.method === "OPTIONS") {
    if (!originAllowed) {
      return new Response("Origin not allowed", { status: 403, headers });
    }
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  const ingressError = await requireTrustedEdgeIngress(
    req,
    "contact-sales-submit",
    jsonResponse,
  );
  if (ingressError) return ingressError;

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, {
      error: "Unfortunately ItemTraxx is currently unavailable.",
    });
  }

  try {
    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const salesEmail = resolveEmailAddress("sales");
    const fromEmail = resolveEmailFrom("sales");

    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration." });
    }

    const body = await readJsonBody<ContactPayload>(req, 128 * 1024);
    const website = normalizeText(body.website, 120);
    if (website) {
      return jsonResponse(200, { data: { accepted: true } });
    }

    const plan = requireEnum(body.plan, SALES_PLAN_KEYS);
    const planLabel = plan ? SALES_PLAN_LABELS[plan] : null;
    const name = requireText(body.name, { maxLen: 120 });
    const organization = optionalText(body.organization, { maxLen: 160 });
    const replyEmail = requireEmail(body.reply_email);
    const details = optionalText(body.details, { maxLen: 2500 });
    const schoolsCount = optionalPositiveInteger(body.schools_count, 100_000);
    const intent = optionalEnum(body.intent, CONTACT_INTENTS, "sales");
    const turnstileToken = requireText(body.turnstile_token, { maxLen: 4000 });

    if (!name || !replyEmail || !isEmail(replyEmail)) {
      return jsonResponse(400, { error: "Name and valid email are required." });
    }
    const organizationRequired = ![
      "individual_yearly",
      "individual_monthly",
      "other",
    ].includes(plan);
    if (organizationRequired && !organization) {
      return jsonResponse(400, {
        error: "Organization is required for this plan.",
      });
    }
    if (plan === "workspace_enterprise" && !schoolsCount) {
      return jsonResponse(
        400,
        {
          error: "Number of tenant accounts is required for the Workspace Enterprise plan.",
        },
      );
    }
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const clientIp = resolveClientIp(req);
    // Quota identity must come from the server-observed client, never from
    // caller-controlled email or User-Agent values. The independent global
    // bucket also bounds aggregate sales-form work across many clients.
    const fingerprint = await hashString(
      resolveClientFingerprint(req, req.headers.get("origin"), {
        trustProxyHeader: true,
      }),
    );
    const rateLimit = await enforcePublicRateLimits(
      adminClient,
      fingerprint,
      "contact_sales_submit",
      PUBLIC_RATE_LIMIT.limit,
      PUBLIC_RATE_LIMIT.windowSeconds,
      PUBLIC_GLOBAL_RATE_LIMIT.limit,
    );
    if (!rateLimit.ok) {
      if (rateLimit.error) {
        return jsonResponse(500, { error: "Rate limit check failed." });
      }
      return jsonResponse(429, {
        error: "Too many requests. Please try again later.",
      }, rateLimit);
    }

    const verified = await verifyTurnstileToken(
      turnstileToken,
      clientIp,
      "contact-sales-submit",
    );
    if (!verified) {
      return jsonResponse(403, { error: "Security check failed." });
    }

    const ipHash = clientIp ? await sha256Hex(clientIp) : null;
    const userAgent = normalizeText(req.headers.get("user-agent"), 255) || null;

    const { data: lead, error: insertError } = await adminClient
      .from("sales_leads")
      .insert({
        plan,
        schools_count: plan === "workspace_enterprise" ? schoolsCount : null,
        name,
        organization: organization || null,
        reply_email: replyEmail,
        details: details || null,
        source: "pricing_page",
        ip_hash: ipHash,
        user_agent: userAgent,
      })
      .select("id")
      .single();

    if (insertError || !lead) {
      logError(
        "contact-sales-submit insert failed",
        requestId,
        insertError ?? "missing lead row",
      );
      return jsonResponse(400, { error: "Unable to save sales request." });
    }

    const { error: enqueueError } = await adminClient.rpc("enqueue_async_job", {
      p_job_type: "contact_sales_email",
      p_payload: {
        lead_id: lead.id,
        plan_label: planLabel,
        plan_key: plan,
        schools_count: plan === "workspace_enterprise" ? schoolsCount : null,
        name,
        organization: organization || "Not provided",
        reply_email: replyEmail,
        details: details || null,
        sales_email: salesEmail,
        from_email: fromEmail,
        intent,
      },
      p_priority: 25,
      p_max_attempts: 5,
    });
    if (enqueueError) {
      logError("contact-sales-submit enqueue failed", requestId, enqueueError);
      return jsonResponse(500, { error: "Unable to queue follow-up email." });
    }

    logInfo("contact-sales-submit accepted", requestId, {
      lead_id: lead.id,
      plan,
      intent,
    });
    return jsonResponse(200, { data: { lead_id: lead.id } });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    logError("contact-sales-submit error", requestId, error);
    return jsonResponse(500, { error: "Request failed." });
  }
});
