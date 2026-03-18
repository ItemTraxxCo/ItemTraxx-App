import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { getRequestId, logError, logInfo } from "../_shared/observability.ts";

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

type TurnstileVerifyResult = {
  success: boolean;
  "error-codes"?: string[];
};

type ContactPayload = {
  plan?:
    | "district_core"
    | "district_growth"
    | "district_enterprise"
    | "organization_starter"
    | "organization_scale"
    | "organization_enterprise"
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
  district_core: "ItemTraxx District Core Plan",
  district_growth: "ItemTraxx District Growth Plan",
  district_enterprise: "ItemTraxx District Enterprise Plan",
  organization_starter: "ItemTraxx Organization Starter Plan",
  organization_scale: "ItemTraxx Organization Scale Plan",
  organization_enterprise: "ItemTraxx Organization Enterprise Plan",
  individual_yearly: "ItemTraxx Individual Yearly Plan",
  individual_monthly: "ItemTraxx Individual Monthly Plan",
  other: "Other",
} as const;
type SalesPlanKey = keyof typeof SALES_PLAN_LABELS;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const hashString = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(new Uint8Array(digest));
};

const resolveClientIp = (req: Request) => {
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const firstForwardedIp = forwardedFor.split(",")[0]?.trim() ?? "";
  const connectingIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  const realIp = req.headers.get("x-real-ip")?.trim() ?? "";
  return firstForwardedIp || connectingIp || realIp || "";
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const hasOrigin = !!origin;
  const originAllowed =
    !hasOrigin || (hasOrigin && allowedOrigins.includes(origin as string));

  const headers =
    hasOrigin && originAllowed
      ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...baseCorsHeaders };

  return { hasOrigin, originAllowed, headers };
};

const verifyTurnstileToken = async (
  secret: string,
  token: string,
  remoteIp: string
) => {
  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", token);
  if (remoteIp) {
    params.set("remoteip", remoteIp);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    return false;
  }

  const result = (await response.json()) as TurnstileVerifyResult;
  return !!result.success;
};

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);
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

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }

  try {
    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");
    const turnstileSecret =
      Deno.env.get("ITX_TURNSTILE_SECRET") ??
      Deno.env.get("ITX_TURNSTILE_SECRET_KEY");
    const supportEmail = Deno.env.get("ITX_SUPPORT_EMAIL") ?? "support@itemtraxx.com";
    const fromEmail =
      Deno.env.get("ITX_EMAIL_FROM") ??
      Deno.env.get("ITX_RESEND_FROM") ??
      "ItemTraxx Sales <support@itemtraxx.com>";

    if (!supabaseUrl || !publishableKey || !serviceKey || !turnstileSecret) {
      return jsonResponse(500, { error: "Server misconfiguration." });
    }

    const body = (await req.json()) as ContactPayload;
    const plan = body.plan as SalesPlanKey | undefined;
    const planLabel = plan ? SALES_PLAN_LABELS[plan] : null;
    const name = normalizeText(body.name, 120);
    const organization = normalizeText(body.organization, 160);
    const replyEmail = normalizeText(body.reply_email, 254).toLowerCase();
    const details = normalizeText(body.details, 2500);
    const schoolsCountRaw = Number(body.schools_count);
    const schoolsCount = Number.isFinite(schoolsCountRaw) && schoolsCountRaw > 0
      ? Math.round(schoolsCountRaw)
      : null;
    const website = normalizeText(body.website, 120);
    const intent = body.intent === "demo" ? "demo" : "sales";
    const turnstileToken = normalizeText(body.turnstile_token, 4000);

    if (website) {
      return jsonResponse(200, { data: { accepted: true } });
    }

    if (!plan || !(plan in SALES_PLAN_LABELS)) {
      return jsonResponse(400, { error: "Invalid plan." });
    }
    if (!name || !replyEmail || !isEmail(replyEmail)) {
      return jsonResponse(400, { error: "Name and valid email are required." });
    }
    const organizationRequired = !["individual_yearly", "individual_monthly", "other"].includes(plan);
    if (organizationRequired && !organization) {
      return jsonResponse(400, { error: "Organization is required for this plan." });
    }
    if (
      (plan === "district_enterprise" || plan === "organization_enterprise") &&
      !schoolsCount
    ) {
      return jsonResponse(
        400,
        {
          error:
            plan === "district_enterprise"
              ? "Number of schools is required for district enterprise."
              : "Number of locations or teams is required for organization enterprise.",
        },
      );
    }
    if (!turnstileToken) {
      return jsonResponse(400, { error: "Security check required." });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const clientIp = resolveClientIp(req);
    const fingerprintSource = `${clientIp}|${replyEmail}|${req.headers.get("user-agent") ?? ""}`;
    const fingerprint = await hashString(fingerprintSource);

    const { data: rateLimit, error: rateLimitError } = await adminClient.rpc(
      "consume_rate_limit_prelogin",
      {
        p_key: fingerprint,
        p_scope: "contact_sales_submit",
        p_limit: 5,
        p_window_seconds: 3600,
      }
    );
    if (rateLimitError) {
      return jsonResponse(500, { error: "Rate limit check failed." });
    }
    const rateLimitResult = rateLimit as RateLimitResult;
    if (!rateLimitResult.allowed) {
      return jsonResponse(429, { error: "Too many requests. Please try again later." });
    }

    const verified = await verifyTurnstileToken(turnstileSecret, turnstileToken, clientIp);
    if (!verified) {
      return jsonResponse(403, { error: "Security check failed." });
    }

    const ipHash = clientIp ? await hashString(clientIp) : null;
    const userAgent = normalizeText(req.headers.get("user-agent"), 255) || null;

    const { data: lead, error: insertError } = await adminClient
      .from("sales_leads")
      .insert({
        plan,
        schools_count:
          plan === "district_enterprise" || plan === "organization_enterprise"
            ? schoolsCount
            : null,
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
      logError("contact-sales-submit insert failed", requestId, insertError ?? "missing lead row");
      return jsonResponse(400, { error: "Unable to save sales request." });
    }

    const { error: enqueueError } = await adminClient.rpc("enqueue_async_job", {
      p_job_type: "contact_sales_email",
      p_payload: {
        lead_id: lead.id,
        plan_label: planLabel,
        plan_key: plan,
        schools_count:
          plan === "district_enterprise" || plan === "organization_enterprise"
            ? schoolsCount
            : null,
        name,
        organization: organization || "Not provided",
        reply_email: replyEmail,
        details: details || null,
        support_email: supportEmail,
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

    logInfo("contact-sales-submit accepted", requestId, { lead_id: lead.id, plan, intent });
    return jsonResponse(200, { data: { lead_id: lead.id } });
  } catch (error) {
    logError("contact-sales-submit error", requestId, error);
    return jsonResponse(500, { error: "Request failed." });
  }
});
