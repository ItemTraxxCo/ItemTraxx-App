import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import {
  isKillSwitchEnabled,
  isLocalhostBypassRequest,
  resolveKillSwitchMessage,
} from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import {
  enforcePreloginRateLimit,
  resolvePublicStatusClient,
} from "../_shared/preloginGuards.ts";
import { buildPublicRateLimitHeaders } from "../_shared/publicRateLimit.ts";
import { resolveSystemStatusOverride } from "../_shared/systemStatusOverride.ts";
import { hasTrustedEdgeIngress } from "../_shared/trustedIngress.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  Vary: "Origin",
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));

  const hasOrigin = !!origin;
  const originAllowed =
    !hasOrigin || (hasOrigin && isAllowedOrigin(origin as string, allowedOrigins));

  const headers =
    hasOrigin && originAllowed
      ? { ...corsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...corsHeaders };

  return { hasOrigin, originAllowed, headers };
};

type IncidentImpact =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "full_outage";

type IncidentComponent = {
  current_status?: IncidentImpact;
};

type OngoingIncident = {
  current_worst_impact?: IncidentImpact;
  affected_components?: IncidentComponent[];
};

type IncidentWidgetPayload = {
  ongoing_incidents?: OngoingIncident[];
  in_progress_maintenances?: unknown[];
  scheduled_maintenances?: unknown[];
};

// This endpoint is intentionally public and unauthenticated -- the app shell
// probes it before any session exists, and external status consumers may call
// the origin directly. What it should not be is a free amplifier: each request
// otherwise costs a service-role DB probe, three app_runtime_config reads, and
// an outbound incident.io fetch.
//
// Two bounds, neither of which changes the public contract:
//   1. a short in-memory cache of the derived incident.io verdict, shared by
//      every request an isolate serves;
//   2. a per-client rate limit for trusted Worker traffic and server-issued
//      identities for direct callers, plus a separate direct aggregate budget.
const INCIDENT_CACHE_TTL_MS = 20_000;
const STATUS_RATE_LIMIT_PER_MINUTE = 60;
const STATUS_RATE_LIMIT_WINDOW_SECONDS = 60;
const STATUS_DIRECT_GLOBAL_LIMIT_PER_MINUTE = 600;

type CachedIncidentStatus = {
  status: "operational" | "degraded" | "down";
  summary: string;
  check: "ok" | "warn" | "unavailable";
  fetchedAt: number;
};

let cachedIncidentStatus: CachedIncidentStatus | null = null;

const readCachedIncidentStatus = () =>
  cachedIncidentStatus &&
    Date.now() - cachedIncidentStatus.fetchedAt < INCIDENT_CACHE_TTL_MS
    ? cachedIncidentStatus
    : null;

const resolveIncidentStatus = (
  payload: IncidentWidgetPayload
): { status: "operational" | "degraded" | "down"; summary: string } => {
  const ongoing = payload.ongoing_incidents ?? [];
  const inProgressMaintenances = payload.in_progress_maintenances ?? [];
  const scheduledMaintenances = payload.scheduled_maintenances ?? [];

  const impacts: IncidentImpact[] = [];

  for (const incident of ongoing) {
    if (incident.current_worst_impact) {
      impacts.push(incident.current_worst_impact);
    }
    for (const component of incident.affected_components ?? []) {
      if (component.current_status) {
        impacts.push(component.current_status);
      }
    }
  }

  if (impacts.includes("full_outage")) {
    return { status: "down", summary: "incident full outage" as const };
  }

  if (
    ongoing.length > 0 ||
    impacts.includes("partial_outage") ||
    impacts.includes("degraded_performance") ||
    inProgressMaintenances.length > 0
  ) {
    return { status: "degraded", summary: "active incident or maintenance" as const };
  }

  if (scheduledMaintenances.length > 0) {
    return { status: "operational", summary: "scheduled maintenance" as const };
  }

  return { status: "operational", summary: "no active incidents" as const };
};

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);
  let statusClientCookie: string | null = null;

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
    });
    if (statusClientCookie) {
      responseHeaders.append("Set-Cookie", statusClientCookie);
    }
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
  const incidentWidgetUrl = Deno.env.get("ITX_INCIDENT_IO_WIDGET_URL");
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
      auth: { persistSession: false },
    });

    const trustedEdgeIngress = await hasTrustedEdgeIngress(
      req,
      "system-status",
    ).catch(() => false);
    const statusClient = resolvePublicStatusClient(req, trustedEdgeIngress);
    statusClientCookie = statusClient.setCookie ?? null;

    // Bound the unauthenticated request cost. A limiter outage must fail closed
    // so an attacker cannot turn an unavailable guard into an unbounded probe.
    const rateLimit = await enforcePreloginRateLimit(
      adminClient,
      statusClient.key,
      trustedEdgeIngress ? "system-status-edge" : "system-status-direct",
      STATUS_RATE_LIMIT_PER_MINUTE,
      STATUS_RATE_LIMIT_WINDOW_SECONDS
    );
    if (rateLimit.error) {
      return jsonResponse(503, {
        status: "unknown",
        checks: { config: "ok", db: "unknown", rate_limit: "unavailable" },
        incident_summary: "rate limiter unavailable",
        duration_ms: Date.now() - startedAt,
        checked_at: new Date().toISOString(),
      });
    }

    if (!trustedEdgeIngress) {
      const directGlobalRateLimit = await enforcePreloginRateLimit(
        adminClient,
        "global",
        "system-status-direct-global",
        STATUS_DIRECT_GLOBAL_LIMIT_PER_MINUTE,
        STATUS_RATE_LIMIT_WINDOW_SECONDS,
      );
      if (directGlobalRateLimit.error) {
        return jsonResponse(503, {
          status: "unknown",
          checks: { config: "ok", db: "unknown", rate_limit: "unavailable" },
          incident_summary: "rate limiter unavailable",
          duration_ms: Date.now() - startedAt,
          checked_at: new Date().toISOString(),
        });
      }
      if (!directGlobalRateLimit.ok) {
        return jsonResponse(429, {
          status: "unknown",
          checks: { config: "ok", db: "unknown" },
          incident_summary: "rate limited",
          duration_ms: Date.now() - startedAt,
          checked_at: new Date().toISOString(),
        }, {
          retryAfterSeconds: directGlobalRateLimit.retryAfterSeconds ??
            STATUS_RATE_LIMIT_WINDOW_SECONDS,
          remaining: 0,
        });
      }
    }
    if (!rateLimit.ok && !rateLimit.error) {
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

    const { error } = await adminClient
      .from("profiles")
      .select("id", { head: true, count: "exact" })
      .limit(1);

    if (error) {
      return jsonResponse(503, {
        status: "down",
        checks: {
          config: "ok",
          db: "failed",
        },
        duration_ms: Date.now() - startedAt,
        checked_at: new Date().toISOString(),
      });
    }

    let incidentStatus: "operational" | "degraded" | "down" = "operational";
    let incidentSummary = "not configured";
    let incidentCheck: "ok" | "warn" | "unavailable" = "unavailable";
    const killSwitchActive = isKillSwitchEnabled() && !isLocalhostBypassRequest(req);
    let broadcast: {
      enabled: boolean;
      message: string;
      level: "info" | "warning" | "critical";
      updated_at: string;
    } | null = null;

    const [broadcastResult, maintenanceResult, systemStatusOverrideResult] = await Promise.all([
      adminClient
        .from("app_runtime_config")
        .select("key, value, updated_at")
        .eq("key", "broadcast_message")
        .maybeSingle(),
      adminClient
        .from("app_runtime_config")
        .select("value, updated_at")
        .eq("key", "maintenance_mode")
        .maybeSingle(),
      adminClient
        .from("app_runtime_config")
        .select("value")
        .eq("key", "system_status_override")
        .maybeSingle(),
    ]);
    const { data: broadcastRow, error: broadcastError } = broadcastResult;
    const { data: maintenanceRow } = maintenanceResult;
    const { data: systemStatusOverrideRow } = systemStatusOverrideResult;

    let maintenance: {
      enabled: boolean;
      message: string;
      updated_at: string;
    } | null = null;

    if (maintenanceRow?.value && typeof maintenanceRow.value === "object") {
      const value = maintenanceRow.value as Record<string, unknown>;
      maintenance = {
        enabled: value.enabled === true,
        message:
          typeof value.message === "string" && value.message.trim()
            ? value.message.trim()
            : "Maintenance in progress.",
        updated_at:
          typeof value.updated_at === "string" && value.updated_at
            ? value.updated_at
            : maintenanceRow.updated_at ?? new Date().toISOString(),
      };
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

    const cachedIncident = readCachedIncidentStatus();
    if (incidentWidgetUrl && cachedIncident) {
      incidentStatus = cachedIncident.status;
      incidentSummary = cachedIncident.summary;
      incidentCheck = cachedIncident.check;
    } else if (incidentWidgetUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        let response: Response;
        try {
          response = await fetch(incidentWidgetUrl, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          throw new Error(`Incident widget request failed (${response.status})`);
        }

        const payload = (await response.json()) as IncidentWidgetPayload;
        const mapped = resolveIncidentStatus(payload);
        incidentStatus = mapped.status;
        incidentSummary = mapped.summary;
        incidentCheck = mapped.status === "operational" ? "ok" : "warn";
        cachedIncidentStatus = {
          status: incidentStatus,
          summary: incidentSummary,
          check: incidentCheck,
          fetchedAt: Date.now(),
        };
      } catch (error) {
        incidentStatus = "operational";
        incidentSummary = "incident source unavailable";
        incidentCheck = "unavailable";
        // Cache the failure too, so an incident.io outage does not turn into a
        // per-request outbound retry storm.
        cachedIncidentStatus = {
          status: incidentStatus,
          summary: incidentSummary,
          check: incidentCheck,
          fetchedAt: Date.now(),
        };
        console.error("system-status incident.io fetch failed:", error);
      }
    }

    const statusOverride = resolveSystemStatusOverride(systemStatusOverrideRow?.value);
    if (statusOverride) {
      incidentStatus = statusOverride.status;
      incidentSummary = statusOverride.summary;
      incidentCheck = statusOverride.status === "operational" ? "ok" : "warn";
    }

    if (killSwitchActive) {
      incidentStatus = "down";
      incidentSummary = "global killswitch enabled";
      incidentCheck = "warn";
    }

    return jsonResponse(200, {
      status: incidentStatus,
      checks: {
        config: "ok",
        db: "ok",
        incident_io: incidentCheck,
      },
      kill_switch: {
        enabled: killSwitchActive,
        message: killSwitchMessage,
      },
      broadcast,
      maintenance,
      incident_summary: incidentSummary,
      duration_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    });
  } catch {
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
});
