import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  Vary: "Origin",
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

const resolveIncidentStatus = (payload: IncidentWidgetPayload) => {
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

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

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
  const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
  const serviceKey = Deno.env.get("ITX_SECRET_KEY");
  const incidentWidgetUrl = Deno.env.get("ITX_INCIDENT_IO_WIDGET_URL");

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
    let broadcast: {
      enabled: boolean;
      message: string;
      level: "info" | "warning" | "critical";
      updated_at: string;
    } | null = null;

    const { data: broadcastRow, error: broadcastError } = await adminClient
      .from("app_runtime_config")
      .select("key, value, updated_at")
      .eq("key", "broadcast_message")
      .maybeSingle();

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

    if (incidentWidgetUrl) {
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
      } catch (error) {
        incidentStatus = "operational";
        incidentSummary = "incident source unavailable";
        incidentCheck = "unavailable";
        console.error("system-status incident.io fetch failed:", error);
      }
    }

    return jsonResponse(200, {
      status: incidentStatus,
      checks: {
        config: "ok",
        db: "ok",
        incident_io: incidentCheck,
      },
      broadcast,
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
      duration_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    });
  }
});
