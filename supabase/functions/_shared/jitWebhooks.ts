import {
  applyEmailTheme,
  buildEmailBrandHeaderHtml,
  withEmailBrandLogoAttachment,
} from "./emailBranding.ts";
import { resolveEmailAddress, resolveEmailFrom } from "./emailConfig.ts";
import { sendLoggedResendEmail } from "./emailDeliveryLog.ts";
import type { JitScope } from "./jitTicket.ts";

export type JitAuditEventType =
  | "jit.ticket.requested"
  | "jit.ticket.granted"
  | "jit.ticket.used"
  | "jit.ticket.revoked"
  | "jit.ticket.expired"
  | "jit.break_glass.invoked"
  | "jit.break_glass.alert_failed"
  | "jit.access.denied";

export type JitWebhookPayload = {
  event_id: string;
  event_type: JitAuditEventType;
  timestamp_utc: string;
  actor: {
    id: string;
    email: string | null;
  };
  target_workspace_id: string | null;
  ticket_id: string | null;
  scope: JitScope | null;
  action: string;
  reason: string | null;
  incident_id?: string | null;
  acknowledged_by?: string | null;
  client: {
    ip_hash: string | null;
    user_agent: string | null;
    request_id: string | null;
  };
  metadata?: Record<string, unknown>;
};

export type JitAlertChannelKind = "webhook" | "resend_email";

export type JitAlertDeliveryAttempt = {
  channel: string;
  kind: JitAlertChannelKind;
  delivered: boolean;
  attempts: number;
  status?: number;
  error?: string;
};

export type JitWebhookDispatchResult = {
  eventSignature: string;
  attemptedChannels: string[];
  deliveredChannels: string[];
  failedChannels: JitAlertDeliveryAttempt[];
  quorumMet: boolean;
  deliveryStatus: "delivered" | "partial" | "failed";
  queuedRetries: number;
};

const encoder = new TextEncoder();
const DEFAULT_INLINE_BACKOFF_MS = [0, 300, 900];
const DEFAULT_WEBHOOK_TIMEOUT_MS = 2500;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const timingSafeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
};

export const signJitWebhookEvent = async (
  rawBody: string,
  timestampSec: number,
  secret: string,
): Promise<string> => {
  if (!secret || secret.length < 16) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${timestampSec}.${rawBody}`),
    ),
  );
  return `t=${timestampSec},v1=${toHex(digest)}`;
};

export const verifyJitWebhookSignature = async (
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> => {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signatureHeader.trim());
  if (!match) return false;
  const timestampSec = Number(match[1]);
  if (!Number.isSafeInteger(timestampSec) || timestampSec <= 0) return false;
  const expected = await signJitWebhookEvent(rawBody, timestampSec, secret);
  return Boolean(expected) && timingSafeEqual(signatureHeader.trim(), expected);
};

export const computeExponentialBackoffMs = (
  attempt: number,
  baseMs = 30_000,
  maxMs = 60 * 60_000,
): number => {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(maxMs, baseMs * Math.pow(2, safeAttempt - 1));
};

export const parseAllowedWebhookUrls = (raw: string | undefined | null): string[] => {
  if (!raw) return [];
  const results: string[] = [];
  for (const candidate of raw.split(",")) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        continue;
      }
      results.push(parsed.toString());
    } catch {
      // Ignore malformed URL entries rather than throwing on unrelated webhooks.
    }
  }
  return [...new Set(results)];
};

export const buildBreakGlassSecurityEmailHtml = (
  payload: JitWebhookPayload,
  logoUrl?: string | null,
): string => {
  const isFailure = payload.event_type === "jit.break_glass.alert_failed";
  const heading = isFailure
    ? "Break-Glass Alert Delivery Failed (Blocked)"
    : "Emergency Break-Glass Access Invoked";
  const badgeText = isFailure ? "BLOCKED / ALERT FAILURE" : "BREAK-GLASS ACTIVE";
  const badgeBg = isFailure ? "#fef2f2" : "#fff7ed";
  const badgeColor = isFailure ? "#991b1b" : "#9a3412";
  const badgeBorder = isFailure ? "#fecaca" : "#fed7aa";

  const actorLabel = escapeHtml(payload.actor.email ?? payload.actor.id);
  const workspaceLabel = escapeHtml(payload.target_workspace_id ?? "N/A");
  const ticketLabel = escapeHtml(payload.ticket_id ?? "Not granted");
  const incidentLabel = payload.incident_id ? escapeHtml(payload.incident_id) : "Not provided";
  const acknowledgedBy = escapeHtml(payload.acknowledged_by ?? "Not specified");
  const justification = escapeHtml(payload.reason ?? "No justification supplied")
    .replaceAll("\n", "<br />");
  const occurredAt = escapeHtml(payload.timestamp_utc);
  const requestId = escapeHtml(payload.client.request_id ?? "N/A");
  const ipHash = escapeHtml(payload.client.ip_hash ?? "unavailable");

  const rawHtml = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;color:#171717;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f5f2;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d8d6d1;border-radius:0;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px 14px 28px;background:#ffffff;border-bottom:1px solid #e7e5df;color:#171717;">
                ${buildEmailBrandHeaderHtml({ logoUrl, brandName: "ItemTraxx" })}
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 12px 0;">
                  <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${badgeBg};border:1px solid ${badgeBorder};color:${badgeColor};font-size:11px;font-weight:700;letter-spacing:0.06em;">${badgeText}</span>
                </p>
                <h2 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;color:#171717;">${heading}</h2>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#343330;">
                  A Super Admin ${isFailure ? "attempted to invoke" : "invoked"} emergency break-glass workspace access. All actions are recorded in the immutable <code>jit_audit_log</code> ledger.
                </p>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.7;color:#343330;">
                  <strong>Timestamp (UTC):</strong> ${occurredAt}<br />
                  <strong>Actor:</strong> ${actorLabel}<br />
                  <strong>Target Workspace:</strong> ${workspaceLabel}<br />
                  <strong>Ticket ID:</strong> ${ticketLabel}<br />
                  <strong>Incident ID:</strong> ${incidentLabel}<br />
                  <strong>Acknowledged By:</strong> ${acknowledgedBy}<br />
                  <strong>Request ID:</strong> ${requestId}<br />
                  <strong>Client IP Hash:</strong> ${ipHash}
                </p>
                <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;color:#343330;"><strong>Justification</strong></p>
                <div style="padding:14px 16px;background:#fbfaf8;border:1px solid #d8d6d1;border-radius:0;font-size:14px;line-height:1.7;color:#343330;">${justification}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e7e5df;background:#fbfaf8;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#68645f;">
                  ItemTraxx Security Operations &mdash; Automated Break-Glass Audit Notification
                </p>
                <p style="margin:6px 0 0 0;font-size:12px;line-height:1.6;color:#8b8680;">
                  Review or revoke active tickets in Internal Operations immediately if unauthorized.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return applyEmailTheme(rawHtml);
};

export const buildBreakGlassSecurityEmailText = (payload: JitWebhookPayload): string =>
  [
    payload.event_type === "jit.break_glass.alert_failed"
      ? "[SECURITY CRITICAL] Break-Glass Alert Delivery Failed (Blocked)"
      : "[SECURITY CRITICAL] Emergency Break-Glass Access Invoked",
    "",
    `Timestamp (UTC): ${payload.timestamp_utc}`,
    `Actor: ${payload.actor.email ?? payload.actor.id}`,
    `Target Workspace: ${payload.target_workspace_id ?? "N/A"}`,
    `Ticket ID: ${payload.ticket_id ?? "Not granted"}`,
    `Incident ID: ${payload.incident_id ?? "Not provided"}`,
    `Acknowledged By: ${payload.acknowledged_by ?? "Not specified"}`,
    `Request ID: ${payload.client.request_id ?? "N/A"}`,
    `Client IP Hash: ${payload.client.ip_hash ?? "unavailable"}`,
    "",
    "Justification:",
    payload.reason ?? "No justification supplied",
  ].join("\n");

const isSlackWebhookUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "hooks.slack.com" &&
      parsed.pathname.startsWith("/services/");
  } catch {
    return false;
  }
};

export const formatSlackJitMessage = (payload: JitWebhookPayload): string => {
  const prefix = payload.event_type.startsWith("jit.break_glass")
    ? ":rotating_light: *BREAK-GLASS*"
    : ":key: *JIT Support*";
  const lines = [
    `${prefix} \`${payload.event_type}\``,
    `*Actor:* ${payload.actor.email ?? payload.actor.id}`,
    `*Workspace:* \`${payload.target_workspace_id ?? "N/A"}\``,
    ...(payload.ticket_id ? [`*Ticket ID:* \`${payload.ticket_id}\``] : []),
    ...(payload.scope ? [`*Scope:* \`${payload.scope}\``] : []),
    ...(payload.incident_id ? [`*Incident ID:* \`${payload.incident_id}\``] : []),
    ...(payload.acknowledged_by ? [`*Acknowledged By:* ${payload.acknowledged_by}`] : []),
    ...(payload.reason ? [`*Reason:* ${payload.reason}`] : []),
    `*UTC:* ${payload.timestamp_utc}`,
    ...(payload.client.request_id ? [`*Request ID:* \`${payload.client.request_id}\``] : []),
  ];
  return lines.join("\n");
};

type QueueClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
  };
};

export type JitWebhookDispatchDeps = {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  getEnv?: (name: string) => string | undefined;
  sendResendEmail?: typeof sendLoggedResendEmail;
  inlineBackoffMs?: number[];
  timeoutMs?: number;
  nowSec?: number;
};

const defaultSleep = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms));

const deliverWithInlineBackoff = async (
  deliverOnce: () => Promise<{ ok: boolean; status?: number; error?: string }>,
  backoffMs: number[],
  sleep: (ms: number) => Promise<void>,
): Promise<{ delivered: boolean; attempts: number; status?: number; error?: string }> => {
  let lastStatus: number | undefined;
  let lastError: string | undefined;
  for (let idx = 0; idx < backoffMs.length; idx += 1) {
    if (backoffMs[idx] > 0) await sleep(backoffMs[idx]);
    try {
      const outcome = await deliverOnce();
      lastStatus = outcome.status;
      lastError = outcome.error;
      if (outcome.ok) {
        return { delivered: true, attempts: idx + 1, status: outcome.status };
      }
      // Do not retry 4xx client errors except 408/429.
      if (outcome.status && outcome.status >= 400 && outcome.status < 500 && outcome.status !== 408 && outcome.status !== 429) {
        return { delivered: false, attempts: idx + 1, status: outcome.status, error: outcome.error };
      }
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : "delivery_error";
    }
  }
  return { delivered: false, attempts: backoffMs.length, status: lastStatus, error: lastError };
};

export const deliverSingleWebhookTarget = async (
  params: {
    kind: JitAlertChannelKind;
    url?: string;
    payload: JitWebhookPayload;
    rawBody: string;
    eventSignature: string;
    adminClient?: unknown;
  },
  deps: JitWebhookDispatchDeps = {},
): Promise<{ ok: boolean; status?: number; error?: string }> => {
  const fetcher = deps.fetcher ?? fetch;
  const getEnv = deps.getEnv ?? ((name) => Deno.env.get(name));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;

  if (params.kind === "resend_email") {
    const apiKey = getEnv("ITX_RESEND_API_KEY")?.trim() ||
      getEnv("RESEND_API_KEY")?.trim() ||
      "";
    if (!apiKey) return { ok: false, error: "resend_unconfigured" };
    const securityTo = resolveEmailAddress("security");
    const securityFrom = resolveEmailFrom("security");
    const logoUrl = getEnv("ITX_EMAIL_LOGO_URL")?.trim() || null;
    const subject = params.payload.event_type === "jit.break_glass.alert_failed"
      ? `[SECURITY CRITICAL] Break-Glass Blocked (${params.payload.target_workspace_id ?? "unknown"})`
      : `[SECURITY CRITICAL] Break-Glass Access Invoked (${params.payload.target_workspace_id ?? "unknown"})`;
    const resendPayload = withEmailBrandLogoAttachment({
      from: securityFrom,
      to: [securityTo],
      subject,
      html: buildBreakGlassSecurityEmailHtml(params.payload, logoUrl),
      text: buildBreakGlassSecurityEmailText(params.payload),
    });

    const emailSender = deps.sendResendEmail ?? sendLoggedResendEmail;
    if (params.adminClient) {
      await emailSender(
        params.adminClient as never,
        apiKey,
        resendPayload,
        {
          emailType: "jit_break_glass_alert",
          recipientEmail: securityTo,
          subject,
          requestContext: {
            function_name: "super-ops",
            request_id: params.payload.client.request_id,
          },
          triggeredByUserId: params.payload.actor.id,
          workspaceId: params.payload.target_workspace_id,
          metadata: {
            event_id: params.payload.event_id,
            event_type: params.payload.event_type,
            ticket_id: params.payload.ticket_id,
          },
        },
      );
      return { ok: true, status: 200 };
    }

    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? undefined : `http_${response.status}`,
    };
  }

  if (!params.url) return { ok: false, error: "missing_webhook_url" };
  const isSlack = isSlackWebhookUrl(params.url);
  const body = isSlack
    ? JSON.stringify({ text: formatSlackJitMessage(params.payload) })
    : params.rawBody;
  const response = await fetcher(params.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(!isSlack
        ? {
          "X-ITX-Event-Id": params.payload.event_id,
          "X-ITX-Event-Type": params.payload.event_type,
          ...(params.eventSignature ? { "X-ITX-Webhook-Signature": params.eventSignature } : {}),
        }
        : {}),
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    ok: response.ok,
    status: response.status,
    error: response.ok ? undefined : `http_${response.status}`,
  };
};

export const enqueueJitWebhookRetry = async (
  adminClient: QueueClient | null | undefined,
  jobPayload: {
    kind: JitAlertChannelKind;
    url?: string;
    payload: JitWebhookPayload;
    event_signature: string;
  },
  delayMs = 30_000,
): Promise<boolean> => {
  if (!adminClient) return false;
  try {
    const { error } = await adminClient.from("async_jobs").insert({
      job_type: "jit_audit_webhook",
      status: "queued",
      attempts: 0,
      max_attempts: 6,
      run_after: new Date(Date.now() + delayMs).toISOString(),
      payload: jobPayload,
    });
    return !error;
  } catch {
    return false;
  }
};

export const dispatchJitSecurityEvent = async (
  params: {
    payload: JitWebhookPayload;
    adminClient?: QueueClient | null;
    isBreakGlass?: boolean;
  },
  deps: JitWebhookDispatchDeps = {},
): Promise<JitWebhookDispatchResult> => {
  const getEnv = deps.getEnv ?? ((name) => Deno.env.get(name));
  const sleep = deps.sleep ?? defaultSleep;
  const isBreakGlass = Boolean(
    params.isBreakGlass ||
      params.payload.event_type === "jit.break_glass.invoked" ||
      params.payload.event_type === "jit.break_glass.alert_failed",
  );
  const backoff = deps.inlineBackoffMs ??
    (isBreakGlass ? DEFAULT_INLINE_BACKOFF_MS : [0]);

  const rawBody = JSON.stringify(params.payload);
  const timestampSec = deps.nowSec ?? Math.floor(Date.now() / 1000);
  const signingSecret = getEnv("ITX_AUDIT_WEBHOOK_SIGNING_SECRET")?.trim() ||
    getEnv("ITX_EDGE_PROXY_SHARED_SECRET")?.trim() ||
    "";
  const eventSignature = await signJitWebhookEvent(rawBody, timestampSec, signingSecret);

  const targets: Array<{ channel: string; kind: JitAlertChannelKind; url?: string }> = [];
  const webhookUrls = parseAllowedWebhookUrls(getEnv("ITX_JIT_AUDIT_WEBHOOK_URLS"));
  webhookUrls.forEach((url, index) => {
    targets.push({ channel: `webhook:${index}`, kind: "webhook", url });
  });

  if (isBreakGlass) {
    const resendKey = getEnv("ITX_RESEND_API_KEY")?.trim() || getEnv("RESEND_API_KEY")?.trim();
    if (resendKey) {
      targets.push({ channel: "resend_email", kind: "resend_email" });
    }
  }

  const attempts = await Promise.all(
    targets.map(async (target): Promise<JitAlertDeliveryAttempt & { url?: string }> => {
      const result = await deliverWithInlineBackoff(
        () =>
          deliverSingleWebhookTarget(
            {
              kind: target.kind,
              url: target.url,
              payload: params.payload,
              rawBody,
              eventSignature,
              adminClient: params.adminClient,
            },
            deps,
          ),
        backoff,
        sleep,
      );
      return {
        channel: target.channel,
        kind: target.kind,
        url: target.url,
        ...result,
      };
    }),
  );

  const attemptedChannels = attempts.map((item) => item.channel);
  const deliveredChannels = attempts.filter((item) => item.delivered).map((item) => item.channel);
  const failedChannels = attempts.filter((item) => !item.delivered);

  let queuedRetries = 0;
  for (const failed of failedChannels) {
    const enqueued = await enqueueJitWebhookRetry(params.adminClient, {
      kind: failed.kind,
      ...(failed.url ? { url: failed.url } : {}),
      payload: params.payload,
      event_signature: eventSignature,
    });
    if (enqueued) queuedRetries += 1;
  }

  const allowDegraded = getEnv("ITX_BREAK_GLASS_ALLOW_DEGRADED_ALERT")?.trim().toLowerCase() === "true";
  const quorumMet = !isBreakGlass || deliveredChannels.length >= 1 || allowDegraded;
  const deliveryStatus: "delivered" | "partial" | "failed" = deliveredChannels.length === 0
    ? "failed"
    : failedChannels.length === 0
    ? "delivered"
    : "partial";

  return {
    eventSignature,
    attemptedChannels,
    deliveredChannels,
    failedChannels: failedChannels.map(({ url: _omitted, ...rest }) => rest),
    quorumMet,
    deliveryStatus,
    queuedRetries,
  };
};
