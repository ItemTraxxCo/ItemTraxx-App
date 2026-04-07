import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { getRequestId, logError, logInfo } from "../_shared/observability.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { resolveClientIp } from "../_shared/preloginGuards.ts";

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

type SupportPayload = {
  name?: string;
  reply_email?: string;
  subject?: string;
  category?: "general" | "bug" | "billing" | "access" | "feature" | "other";
  message?: string;
  turnstile_token?: string;
  website?: string;
  attachments?: Array<{
    filename?: string;
    content_type?: string;
    content_base64?: string;
    size_bytes?: number;
  }>;
};

type NormalizedAttachment = {
  filename: string;
  content_type: string;
  content_base64: string;
  size_bytes: number;
};

type DetectedAttachmentType = {
  contentType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  extension: "png" | "jpg" | "webp" | "gif";
};

const normalizeText = (value: unknown, max = 5000) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
};

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
const estimateBase64DecodedBytes = (value: string) => {
  const normalized = value.replace(/\s+/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
};

const decodeBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const detectAttachmentType = (bytes: Uint8Array): DetectedAttachmentType | null => {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" };
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { contentType: "image/gif", extension: "gif" };
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }

  return null;
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const hashString = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(new Uint8Array(digest));
};

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

const verifyTurnstileToken = async (
  secret: string,
  token: string,
  remoteIp: string,
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
    },
  );

  if (!response.ok) return false;
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
      "ItemTraxx Support <support@itemtraxx.com>";

    if (!supabaseUrl || !publishableKey || !serviceKey || !turnstileSecret) {
      return jsonResponse(500, { error: "Server misconfiguration." });
    }

    const body = (await req.json()) as SupportPayload;
    const name = normalizeText(body.name, 120);
    const replyEmail = normalizeText(body.reply_email, 254).toLowerCase();
    const subject = normalizeText(body.subject, 160);
    const category = normalizeText(body.category, 40).toLowerCase();
    const message = normalizeText(body.message, 3000);
    const website = normalizeText(body.website, 120);
    const turnstileToken = normalizeText(body.turnstile_token, 4000);
    const attachmentsRaw = Array.isArray(body.attachments) ? body.attachments : [];
    const attachments: NormalizedAttachment[] = [];

    if (website) {
      return jsonResponse(200, { data: { accepted: true } });
    }

    if (!name || !replyEmail || !isEmail(replyEmail) || !subject || !message) {
      return jsonResponse(400, { error: "Name, valid email, subject, and message are required." });
    }
    if (!["general", "bug", "billing", "access", "feature", "other"].includes(category)) {
      return jsonResponse(400, { error: "Invalid category." });
    }
    if (!turnstileToken) {
      return jsonResponse(400, { error: "Security check required." });
    }
    if (attachmentsRaw.length > 2) {
      return jsonResponse(400, { error: "Attach up to 2 images." });
    }
    for (const [index, attachment] of attachmentsRaw.entries()) {
      const contentBase64 = normalizeText(attachment.content_base64, 8_000_000).replace(/\s+/g, "");
      if (!contentBase64 || !base64Pattern.test(contentBase64)) {
        return jsonResponse(400, { error: "Attachment data is invalid." });
      }

      const estimatedSize = estimateBase64DecodedBytes(contentBase64);
      if (estimatedSize > 4 * 1024 * 1024) {
        return jsonResponse(400, { error: "Each image must be 4 MB or smaller." });
      }

      let bytes: Uint8Array;
      try {
        bytes = decodeBase64(contentBase64);
      } catch {
        return jsonResponse(400, { error: "Attachment data is invalid." });
      }

      if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) {
        return jsonResponse(400, { error: "Each image must be 4 MB or smaller." });
      }

      const detectedType = detectAttachmentType(bytes);
      if (!detectedType) {
        return jsonResponse(400, { error: "Only PNG, JPG, WEBP, and GIF attachments are allowed." });
      }

      attachments.push({
        filename: `support-attachment-${index + 1}.${detectedType.extension}`,
        content_type: detectedType.contentType,
        content_base64: contentBase64,
        size_bytes: bytes.length,
      });
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
        p_scope: "contact_support_submit",
        p_limit: 5,
        p_window_seconds: 3600,
      },
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

    const { error: enqueueError } = await adminClient.rpc("enqueue_async_job", {
      p_job_type: "contact_support_email",
      p_payload: {
        name,
        reply_email: replyEmail,
        subject,
        category,
        message,
        attachments,
        support_email: supportEmail,
        from_email: fromEmail,
      },
      p_priority: 20,
      p_max_attempts: 5,
    });
    if (enqueueError) {
      logError("contact-support-submit enqueue failed", requestId, enqueueError);
      return jsonResponse(500, { error: "Unable to queue follow-up email." });
    }

    logInfo("contact-support-submit accepted", requestId, { category });
    return jsonResponse(200, { data: { accepted: true } });
  } catch (error) {
    logError("contact-support-submit error", requestId, error);
    return jsonResponse(500, { error: "Request failed." });
  }
});
