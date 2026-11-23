import { serve } from "../_shared/serve.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import {
  isKillSwitchEnabled,
  isLocalhostBypassRequest,
  resolveKillSwitchMessage,
} from "../_shared/killSwitch.ts";
import { resolveCorsHeaders } from "../_shared/cors.ts";
import {
  enforcePreloginRateLimit,
  resolvePublicStatusClient,
} from "../_shared/preloginGuards.ts";
import { buildPublicRateLimitHeaders } from "../_shared/publicRateLimit.ts";
import { resolveSystemStatusOverride } from "../_shared/systemStatusOverride.ts";
import { hasTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { withRequestSpan } from "../_shared/observability.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, traceparent, tracestate",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  Vary: "Origin",
};

// This endpoint is intentionally public and unauthenticated -- the app shell
// probes it before any session exists, and external status consumers may call
// the origin directly. Explicit maintenance and kill-switch state is owned by
// the Cloudflare Worker; this endpoint reports database health and manual
// status overrides only, with no external incident-provider dependency.
const STATUS_RATE_LIMIT_PER_MINUTE = 60;
const STATUS_RATE_LIMIT_WINDOW_SECONDS = 60;
const STATUS_DIRECT_GLOBAL_LIMIT_PER_MINUTE = 600;

serve((req) => withRequestSpan(req, "GET /functions/system-status", async (span, requestId) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req, corsHeaders);

  const jsonResponse = (
    status: number,
    body: Record<string, unknown>,
    rateLimit: { retryAfterSeconds?: number | null; remaining?: number | null } = {},
  ) => {
    const responseHeaders = new Headers({
      ...headers,
      ...buildPublicRateLimitHeaders({
        limit: STATUS_RATE_LIMIT_PER_MINUTE,
        windowSeconds: STATUS_RATE_LIMIT_WINDOW_SECONDS,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        remaining: rateLimit.remaining,
      }),
      "Content-Type": "application/json",
      "x-request-id": requestId,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: responseHeaders,
    });
  };

  if (req.method === "OPTIONS") {
    if (!originAllowed) {
      return new Response("Origin not allowed", { status: 403, headers });
    }
    return new Response("ok", { headers });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const killSwitchMessage = resolveKillSwitchMessage();

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(500, {
      status: "down",
      checks: {
        config: "failed",
        db: "unknown",
      },
      duration_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    });
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceKey, {
      global: { headers: { traceparent: span.traceparent() } },
      auth: { persistSession: false },
    });

    const trustedEdgeIngress = await hasTrustedEdgeIngress(
      req,
      "system-status",
    ).catch(() => false);
    // The edge proxy already applies PUBLIC_STATUS_RATE_LIMITER before it
    // forwards trusted requests. Keep direct origin access bounded by the
    // fixed database bucket, but don't make maintenance reporting depend on a
    // second rate-limit RPC to the database.
    if (!trustedEdgeIngress) {
      const statusClient = resolvePublicStatusClient(req, false);
      const rateLimit = await enforcePreloginRateLimit(
        adminClient,
        statusClient.key,
        "system-status-direct-global",
        STATUS_DIRECT_GLOBAL_LIMIT_PER_MINUTE,
        STATUS_RATE_LIMIT_WINDOW_SECONDS,
      );
      if (rateLimit.error) {
        console.error(JSON.stringify({
          evt: "system_status_rate_limiter_unavailable",
          request_id: requestId,
          error_message: rateLimit.error.message ?? null,
        }));
        return jsonResponse(503, {
          status: "unknown",
          checks: { config: "ok", db: "unknown", rate_limit: "unavailable" },
          incident_summary: "rate limiter unavailable",
          duration_ms: Date.now() - startedAt,
          checked_at: new Date().toISOString(),
        });
      }

      if (!rateLimit.ok) {
        return jsonResponse(429, {
          status: "unknown",
          checks: { config: "ok", db: "unknown" },
          incident_summary: "rate limited",
          duration_ms: Date.now() - startedAt,
          checked_at: new Date().toISOString(),
        }, {
          retryAfterSeconds: rateLimit.retryAfterSeconds ?? STATUS_RATE_LIMIT_WINDOW_SECONDS,
          remaining: 0,
        });
      }
    }

    let status: "operational" | "degraded" | "down" = "operational";
    let incidentSummary = "all systems operational";
    const killSwitchActive = isKillSwitchEnabled() && !isLocalhostBypassRequest(req);
    let broadcast: {
      enabled: boolean;
      message: string;
      level: "info" | "warning" | "critical";
      updated_at: string;
    } | null = null;

    const configPromise = Promise.all([
      adminClient
        .from("app_runtime_config")
        .select("key, value, updated_at")
        .eq("key", "broadcast_message")
        .maybeSingle(),
      adminClient
        .from("app_runtime_config")
        .select("value")
        .eq("key", "system_status_override")
        .maybeSingle(),
    ]);

    const configResults = await configPromise;
    const [broadcastResult, systemStatusOverrideResult] = configResults;
    const { data: broadcastRow, error: broadcastError } = broadcastResult;
    const { data: systemStatusOverrideRow, error: systemStatusOverrideError } =
      systemStatusOverrideResult;

    // If both config reads fail, report database unavailability. A missing
    // individual key is tolerated by its reader below.
    if (broadcastError && systemStatusOverrideError) {
      console.error(JSON.stringify({
        evt: "system_status_db_unavailable",
        request_id: requestId,
        error_code: systemStatusOverrideError.code ?? null,
        error_message: systemStatusOverrideError.message ?? null,
      }));
      return jsonResponse(503, {
        status: "down",
        checks: {
          config: "ok",
          db: "failed",
        },
        incident_summary: "system status config unavailable",
        kill_switch: {
          enabled: killSwitchActive,
          message: killSwitchMessage,
        },
        duration_ms: Date.now() - startedAt,
        checked_at: new Date().toISOString(),
      });
    }

    if (!broadcastError && broadcastRow?.value && typeof broadcastRow.value === "object") {
      const value = broadcastRow.value as Record<string, unknown>;
      const enabled = value.enabled === true;
      const message = typeof value.message === "string" ? value.message.trim() : "";
      const level =
        value.level === "warning" || value.level === "critical" ? value.level : "info";
      if (enabled && message) {
        broadcast = {
          enabled: true,
          message,
          level,
          updated_at:
            typeof value.updated_at === "string" && value.updated_at
              ? value.updated_at
              : broadcastRow.updated_at ?? new Date().toISOString(),
        };
      }
    }

    const statusOverride = resolveSystemStatusOverride(systemStatusOverrideRow?.value);
    if (statusOverride) {
      status = statusOverride.status;
      incidentSummary = statusOverride.summary;
    }

    if (killSwitchActive) {
      status = "down";
      incidentSummary = "global killswitch enabled";
    }

    return jsonResponse(200, {
      status,
      checks: {
        config: "ok",
        db: "ok",
      },
      kill_switch: {
        enabled: killSwitchActive,
        message: killSwitchMessage,
      },
      broadcast,
      incident_summary: incidentSummary,
      duration_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    span.recordException(error);
    console.error(JSON.stringify({
      evt: "system_status_unhandled_error",
      request_id: requestId,
      error_message: error instanceof Error ? error.message : String(error),
    }));
    return jsonResponse(503, {
      status: "down",
      checks: {
        config: "ok",
        db: "failed",
      },
      kill_switch: {
        enabled: false,
        message: killSwitchMessage,
      },
      duration_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    });
  }
}));
