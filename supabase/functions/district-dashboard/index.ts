import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  Vary: "Origin",
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const hasOrigin = !!origin;
  const originAllowed = !hasOrigin || allowedOrigins.includes(origin as string);
  const headers =
    hasOrigin && originAllowed
      ? { ...corsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...corsHeaders };

  return { hasOrigin, originAllowed, headers };
};

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    if (!originAllowed) return new Response("Origin not allowed", { status: 403, headers });
    return new Response("ok", { headers });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
  const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("ITX_SECRET_KEY");
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return jsonResponse(500, { error: "Server misconfiguration" });
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role, district_id")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.role) {
    return jsonResponse(403, { error: "Access denied" });
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  let districtId: string | null = null;
  if (profile.role === "district_admin") {
    districtId = profile.district_id ?? null;
  } else if (profile.role === "super_admin") {
    const url = new URL(req.url);
    districtId = url.searchParams.get("district_id");
  } else {
    return jsonResponse(403, { error: "Access denied" });
  }

  if (!districtId) {
    return jsonResponse(400, { error: "District context missing." });
  }

  const { data: district, error: districtError } = await adminClient
    .from("districts")
    .select("id, name, slug, support_email, contact_name, is_active, subscription_plan, billing_status, renewal_date, billing_email, invoice_reference")
    .eq("id", districtId)
    .single();

  if (districtError || !district) {
    return jsonResponse(404, { error: "District not found." });
  }

  const { data: supportRequestRows } = await adminClient
    .from("district_support_requests")
    .select("id, requester_email, requester_name, subject, message, priority, status, created_at")
    .eq("district_id", districtId)
    .order("created_at", { ascending: false })
    .limit(20);

  const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: tenantRows } = await adminClient
    .from("tenants")
    .select("id, name, access_code, status, created_at, primary_admin_profile_id")
    .eq("district_id", districtId)
    .order("created_at", { ascending: false });

  const tenants = (tenantRows ?? []) as Array<{
    id: string;
    name: string;
    access_code: string;
    status: "active" | "suspended" | "archived";
    created_at: string;
    primary_admin_profile_id?: string | null;
  }>;

  const profileIds = tenants
    .map((tenant) => tenant.primary_admin_profile_id)
    .filter((value): value is string => !!value);

  let emailById = new Map<string, string | null>();
  if (profileIds.length) {
    const { data: profileRows } = await adminClient
      .from("profiles")
      .select("id, auth_email")
      .in("id", profileIds);
    emailById = new Map(
      ((profileRows ?? []) as Array<{ id: string; auth_email: string | null }>).map((row) => [
        row.id,
        row.auth_email,
      ])
    );
  }

  const { data: metricRows } = await adminClient
    .from("super_reporting_tenant_metrics")
    .select(
      "tenant_id, gear_total, students_total, active_checkouts, overdue_items, transactions_7d"
    )
    .in(
      "tenant_id",
      tenants.map((tenant) => tenant.id)
    );

  const tenantMetrics = ((metricRows ?? []) as Array<Record<string, number | string>>).map((row) => ({
    tenant_id: String(row.tenant_id ?? ""),
    tenant_name:
      tenants.find((tenant) => tenant.id === String(row.tenant_id ?? ""))?.name ??
      String(row.tenant_name ?? "Unknown tenant"),
    gear_total: Number(row.gear_total ?? 0),
    students_total: Number(row.students_total ?? 0),
    active_checkouts: Number(row.active_checkouts ?? 0),
    overdue_items: Number(row.overdue_items ?? 0),
    transactions_7d: Number(row.transactions_7d ?? 0),
  }));

  const usage = tenantMetrics.reduce(
    (acc, row) => ({
      gear_total: acc.gear_total + row.gear_total,
      students_total: acc.students_total + row.students_total,
      active_checkouts: acc.active_checkouts + row.active_checkouts,
      overdue_items: acc.overdue_items + row.overdue_items,
      transactions_7d: acc.transactions_7d + row.transactions_7d,
    }),
    {
      gear_total: 0,
      students_total: 0,
      active_checkouts: 0,
      overdue_items: 0,
      transactions_7d: 0,
    }
  );

  const { data: recentLogs } = tenantIds.length
    ? await adminClient
        .from("gear_logs")
        .select("tenant_id, gear_id, checked_out_by, action_type, action_time")
        .in("tenant_id", tenantIds)
        .in("action_type", ["checkout", "return"])
        .gte("action_time", since24hIso)
        .order("action_time", { ascending: false })
        .limit(400)
    : { data: [] as Array<Record<string, string | null>>, error: null };

  const traffic = {
    checkout_24h: (recentLogs ?? []).filter((row) => row.action_type === "checkout").length,
    return_24h: (recentLogs ?? []).filter((row) => row.action_type === "return").length,
    active_tenants_24h: new Set((recentLogs ?? []).map((row) => row.tenant_id).filter(Boolean)).size,
    events_24h: (recentLogs ?? []).length,
  };

  const trafficHourKeys = Array.from({ length: 24 }, (_, offset) => {
    const date = new Date(Date.now() - (23 - offset) * 60 * 60 * 1000);
    date.setMinutes(0, 0, 0);
    return date.toISOString();
  });
  const trafficByHourMap = new Map(
    trafficHourKeys.map((iso) => [iso, { hour: iso, checkout: 0, return: 0 }])
  );
  for (const log of recentLogs ?? []) {
    const hourDate = new Date(String(log.action_time ?? ""));
    hourDate.setMinutes(0, 0, 0);
    const bucket = trafficByHourMap.get(hourDate.toISOString());
    if (!bucket) continue;
    if (log.action_type === "checkout") bucket.checkout += 1;
    if (log.action_type === "return") bucket.return += 1;
  }

  const gearIds = Array.from(
    new Set((recentLogs ?? []).map((row) => row.gear_id).filter((value): value is string => !!value))
  );
  const studentIds = Array.from(
    new Set((recentLogs ?? []).map((row) => row.checked_out_by).filter((value): value is string => !!value))
  );
  const [gearRows, studentRows] = await Promise.all([
    gearIds.length
      ? adminClient.from("gear").select("id, name, barcode").in("id", gearIds)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? adminClient.from("students").select("id, username, student_id").in("id", studentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const gearById = new Map(
    ((gearRows.data ?? []) as Array<{ id: string; name: string | null; barcode: string | null }>).map(
      (row) => [row.id, row]
    )
  );
  const studentById = new Map(
    ((studentRows.data ?? []) as Array<{ id: string; username: string | null; student_id: string | null }>).map(
      (row) => [row.id, row]
    )
  );
  const recentEvents = (recentLogs ?? []).slice(0, 20).map((row) => ({
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : null,
    tenant_name:
      tenants.find((tenant) => tenant.id === row.tenant_id)?.name ?? "Unknown tenant",
    action_type: row.action_type as "checkout" | "return",
    action_time: String(row.action_time ?? ""),
    gear_name:
      typeof row.gear_id === "string" ? gearById.get(row.gear_id)?.name ?? null : null,
    gear_barcode:
      typeof row.gear_id === "string" ? gearById.get(row.gear_id)?.barcode ?? null : null,
    student_username:
      typeof row.checked_out_by === "string"
        ? studentById.get(row.checked_out_by)?.username ?? null
        : null,
    student_id:
      typeof row.checked_out_by === "string"
        ? studentById.get(row.checked_out_by)?.student_id ?? null
        : null,
  }));

  const needsAttention = [
    ...(usage.overdue_items > 0
      ? [
          {
            key: "district_overdue_items",
            level: "high" as const,
            title: "Overdue items need follow-up",
            count: usage.overdue_items,
          },
        ]
      : []),
    ...(tenantMetrics.filter((item) => item.active_checkouts > 0).length > 0
      ? [
          {
            key: "district_active_checkout_tenants",
            level: "medium" as const,
            title: "Tenants with active checkouts",
            count: tenantMetrics.filter((item) => item.active_checkouts > 0).length,
          },
        ]
      : []),
    ...((supportRequestRows ?? []).filter((row) => row.status === "open").length > 0
      ? [
          {
            key: "district_open_support_requests",
            level: "low" as const,
            title: "Open support requests",
            count: (supportRequestRows ?? []).filter((row) => row.status === "open").length,
          },
        ]
      : []),
  ];

  return jsonResponse(200, {
    data: {
      district,
      support_requests: supportRequestRows ?? [],
      tenant_metrics: tenantMetrics.sort((a, b) => b.transactions_7d - a.transactions_7d),
      traffic,
      traffic_by_hour: Array.from(trafficByHourMap.values()),
      recent_events: recentEvents,
      needs_attention: needsAttention,
      tenants: tenants.map((tenant) => ({
        ...tenant,
        primary_admin_email: tenant.primary_admin_profile_id
          ? emailById.get(tenant.primary_admin_profile_id) ?? null
          : null,
      })),
      usage,
    },
  });
});
