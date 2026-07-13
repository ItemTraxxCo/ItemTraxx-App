import type { SuperOpsContext } from "../context.ts";

export const INTERNAL_OPS_ACTIONS = ["get_internal_ops_snapshot"] as const;

export const handleInternalOpsAction = async (
  context: SuperOpsContext,
): Promise<Response | null> => {
  const { action, adminClient, jsonResponse } = context;

  if (action === "get_internal_ops_snapshot") {
    const nowIso = new Date().toISOString();
    const since15mIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString();

    const [
      recentLogsResult,
      queueRowsResult,
      leadsResult,
      runtimeConfigResult,
      auditRowsResult,
      customerLeadRowsResult,
    ] = await Promise.all([
      adminClient
        .from("gear_logs")
        .select(
          "tenant_id, gear_id, checked_out_by, action_type, action_time",
        )
        .in("action_type", ["checkout", "return"])
        .gte("action_time", since24hIso)
        .order("action_time", { ascending: false })
        .limit(400),
      adminClient
        .from("async_jobs")
        .select("status, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      adminClient
        .from("sales_leads")
        .select("id, lead_state, stage, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      adminClient
        .from("app_runtime_config")
        .select("key, value")
        .in("key", ["maintenance_mode", "broadcast_message"]),
      adminClient
        .from("super_admin_audit_logs")
        .select(
          "id, actor_email, action_type, target_type, target_id, metadata, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      adminClient
        .from("sales_leads")
        .select("id, lead_state, created_at, updated_at")
        .eq("lead_state", "converted_to_customer")
        .order("created_at", { ascending: false })
        .limit(600),
    ]);

    if (recentLogsResult.error) {
      return jsonResponse(400, {
        error: "Unable to load recent traffic logs.",
      });
    }
    if (queueRowsResult.error) {
      return jsonResponse(400, { error: "Unable to load async jobs." });
    }
    if (leadsResult.error) {
      return jsonResponse(400, { error: "Unable to load lead metrics." });
    }
    if (auditRowsResult.error) {
      return jsonResponse(400, { error: "Unable to load audit feed." });
    }
    if (customerLeadRowsResult.error) {
      return jsonResponse(400, {
        error: "Unable to load customer health metrics.",
      });
    }

    const recentLogs = recentLogsResult.data ?? [];
    const logs15m = recentLogs.filter((row) => row.action_time >= since15mIso);
    const checkout15m = logs15m.filter((row) =>
      row.action_type === "checkout"
    ).length;
    const return15m = logs15m.filter((row) =>
      row.action_type === "return"
    ).length;
    const activeTenants15m = new Set(logs15m.map((row) => row.tenant_id)).size;

    const queueRows = queueRowsResult.data ?? [];
    const queueTotal = queueRows.length;
    const queueSummary = {
      queued: queueRows.filter((row) => row.status === "queued").length,
      processing: queueRows.filter((row) => row.status === "processing").length,
      completed: queueRows.filter((row) => row.status === "completed").length,
      failed: queueRows.filter((row) => row.status === "failed").length,
    };

    const leads = leadsResult.data ?? [];
    const leadSummary = {
      open: leads.filter((row) => row.lead_state === "open").length,
      closed: leads.filter((row) => row.lead_state === "closed").length,
      converted:
        leads.filter((row) => row.lead_state === "converted_to_customer")
          .length,
      waiting_for_quote:
        leads.filter((row) => row.stage === "waiting_for_quote").length,
      quote_sent: leads.filter((row) => row.stage === "quote_sent").length,
      invoice_sent: leads.filter((row) => row.stage === "invoice_sent").length,
      invoice_paid: leads.filter((row) => row.stage === "invoice_paid").length,
    };

    const trafficHourKeys = Array.from({ length: 24 }, (_, offset) => {
      const date = new Date(Date.now() - (23 - offset) * 60 * 60 * 1000);
      date.setMinutes(0, 0, 0);
      return date.toISOString();
    });
    const trafficByHourMap = new Map(
      trafficHourKeys.map((
        iso,
      ) => [iso, { hour: iso, checkout: 0, return: 0 }]),
    );
    for (const log of recentLogs) {
      const hourDate = new Date(log.action_time);
      hourDate.setMinutes(0, 0, 0);
      const hourKey = hourDate.toISOString();
      const bucket = trafficByHourMap.get(hourKey);
      if (!bucket) continue;
      if (log.action_type === "checkout") {
        bucket.checkout += 1;
      } else if (log.action_type === "return") {
        bucket.return += 1;
      }
    }

    const leadFunnel = {
      waiting_for_quote:
        leads.filter((row) => row.stage === "waiting_for_quote").length,
      quote_generated:
        leads.filter((row) => row.stage === "quote_generated").length,
      quote_sent: leads.filter((row) => row.stage === "quote_sent").length,
      quote_converted_to_invoice:
        leads.filter((row) => row.stage === "quote_converted_to_invoice")
          .length,
      invoice_sent: leads.filter((row) => row.stage === "invoice_sent").length,
      invoice_paid: leads.filter((row) => row.stage === "invoice_paid").length,
    };

    const tenantIds = Array.from(
      new Set(
        recentLogs.map((row) => row.tenant_id).filter((
          value,
        ): value is string => !!value),
      ),
    );
    const gearIds = Array.from(
      new Set(
        recentLogs.map((row) => row.gear_id).filter((
          value,
        ): value is string => !!value),
      ),
    );
    const studentIds = Array.from(
      new Set(
        recentLogs.map((row) => row.checked_out_by).filter((
          value,
        ): value is string => !!value),
      ),
    );

    const [
      tenantRowsResult,
      gearRowsResult,
      studentRowsResult,
      allTenantsResult,
    ] = await Promise.all([
      tenantIds.length
        ? adminClient.from("tenants").select("id, name").in("id", tenantIds)
        : Promise.resolve({ data: [], error: null }),
      gearIds.length
        ? adminClient.from("gear").select("id, name, barcode").in(
          "id",
          gearIds,
        )
        : Promise.resolve({ data: [], error: null }),
      studentIds.length
        ? adminClient.from("students").select("id, username, student_id").in(
          "id",
          studentIds,
        )
        : Promise.resolve({ data: [], error: null }),
      adminClient
        .from("tenants")
        .select("id, name, status")
        .order("name", { ascending: true })
        .limit(300),
    ]);

    const tenantMap = new Map(
      (tenantRowsResult.data ?? []).map((
        tenant,
      ) => [tenant.id as string, tenant.name as string]),
    );
    const gearMap = new Map(
      (gearRowsResult.data ?? []).map((gear) => [
        gear.id as string,
        {
          name: gear.name as string | null,
          barcode: gear.barcode as string | null,
        },
      ]),
    );
    const studentMap = new Map(
      (studentRowsResult.data ?? []).map((student) => [
        student.id as string,
        {
          username: student.username as string | null,
          student_id: student.student_id as string | null,
        },
      ]),
    );
    const allTenants = (allTenantsResult.data ?? []) as Array<{
      id: string;
      name: string;
      status: string | null;
    }>;

    const recentEvents = recentLogs.slice(0, 40).map((row) => {
      const gear = row.gear_id ? gearMap.get(row.gear_id) : null;
      const student = row.checked_out_by
        ? studentMap.get(row.checked_out_by)
        : null;
      return {
        tenant_id: row.tenant_id,
        tenant_name: row.tenant_id
          ? tenantMap.get(row.tenant_id) ?? "Unknown tenant"
          : "Unknown tenant",
        action_type: row.action_type,
        action_time: row.action_time,
        gear_name: gear?.name ?? null,
        gear_barcode: gear?.barcode ?? null,
        student_username: student?.username ?? null,
        student_id: student?.student_id ?? null,
      };
    });

    const auditRows = (auditRowsResult.data ?? []) as Array<{
      id: string;
      actor_email: string | null;
      action_type: string;
      target_type: string | null;
      target_id: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>;

    const durationSamples = auditRows
      .map((row) => {
        const value = row.metadata?.duration_ms;
        return typeof value === "number" && Number.isFinite(value)
          ? value
          : null;
      })
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    const percentile = (values: number[], p: number) => {
      if (values.length === 0) return null;
      const idx = Math.min(
        values.length - 1,
        Math.max(0, Math.floor((values.length - 1) * p)),
      );
      return values[idx] ?? null;
    };
    const medianDuration = percentile(durationSamples, 0.5);
    const p95Duration = percentile(durationSamples, 0.95);

    const customerLeads = (customerLeadRowsResult.data ?? []) as Array<{
      id: string;
      lead_state: string;
      created_at: string;
      updated_at: string | null;
    }>;
    const customerLeadIds = customerLeads.map((row) => row.id);
    const { data: customerStatusRows, error: customerStatusError } =
      customerLeadIds.length
        ? await adminClient
          .from("customer_status_logs")
          .select("lead_id, status, created_at")
          .in("lead_id", customerLeadIds)
          .order("created_at", { ascending: false })
          .limit(2000)
        : { data: [], error: null };
    if (customerStatusError) {
      return jsonResponse(400, {
        error: "Unable to load customer status metrics.",
      });
    }

    const latestStatusByLead = new Map<string, string>();
    for (
      const row of (customerStatusRows ?? []) as Array<{
        lead_id: string;
        status: string;
        created_at: string;
      }>
    ) {
      if (!latestStatusByLead.has(row.lead_id)) {
        latestStatusByLead.set(row.lead_id, row.status);
      }
    }
    const customerHealth = {
      total_customers: customerLeads.length,
      awaiting_payment: 0,
      canceling: 0,
      paid_late: 0,
      paid_on_time: 0,
      no_status: 0,
    };
    for (const lead of customerLeads) {
      const status = latestStatusByLead.get(lead.id) ?? null;
      if (!status) {
        customerHealth.no_status += 1;
        continue;
      }
      if (status === "awaiting_payment") customerHealth.awaiting_payment += 1;
      if (status === "canceling") customerHealth.canceling += 1;
      if (status === "paid_late") customerHealth.paid_late += 1;
      if (status === "paid_on_time") customerHealth.paid_on_time += 1;
    }

    const staleOpenLeads = leads.filter((row) => {
      if (row.lead_state !== "open") return false;
      const createdAtMs = Date.parse(row.created_at);
      if (Number.isNaN(createdAtMs)) return false;
      return Date.now() - createdAtMs >= 48 * 60 * 60 * 1000;
    }).length;

    const needsAttention = [
      ...(queueSummary.failed > 0
        ? [{
          key: "failed_jobs",
          level: "high",
          title: "Failed async jobs",
          count: queueSummary.failed,
          route: "/super-admin/sales-leads",
        }]
        : []),
      ...(queueSummary.queued >= 15
        ? [{
          key: "queue_backlog",
          level: "medium",
          title: "Async queue backlog",
          count: queueSummary.queued,
          route: "/internal",
        }]
        : []),
      ...(staleOpenLeads > 0
        ? [{
          key: "stale_open_leads",
          level: "medium",
          title: "Open leads older than 48h",
          count: staleOpenLeads,
          route: "/super-admin/sales-leads",
        }]
        : []),
      ...(customerHealth.awaiting_payment + customerHealth.canceling > 0
        ? [{
          key: "customer_billing_risk",
          level: "high",
          title: "Customers requiring billing attention",
          count: customerHealth.awaiting_payment + customerHealth.canceling,
          route: "/super-admin/customers",
        }]
        : []),
    ];

    let statusProbeMs: number | null = null;
    try {
      const { data: statusData } = await adminClient.functions.invoke(
        "system-status",
      );
      if (statusData && typeof statusData === "object") {
        const durationMs = (statusData as Record<string, unknown>).duration_ms;
        if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
          statusProbeMs = durationMs;
        }
      }
    } catch (statusProbeError) {
      console.warn("super-ops status probe failed", statusProbeError);
    }

    const searchIndex = [
      {
        id: "cmd_internal_home",
        label: "Internal dashboard",
        type: "page",
        route: "/internal",
      },
      {
        id: "cmd_super_home",
        label: "Super admin home",
        type: "page",
        route: "/super-admin",
      },
      {
        id: "cmd_sales_leads",
        label: "Sales leads",
        type: "page",
        route: "/super-admin/sales-leads",
      },
      {
        id: "cmd_customers",
        label: "Customers",
        type: "page",
        route: "/super-admin/customers",
      },
      ...allTenants.slice(0, 40).map((tenant) => ({
        id: `tenant_${tenant.id}`,
        label: tenant.name,
        type: "tenant",
        route: "/super-admin/tenants",
      })),
    ];

    const runtimeConfig = Object.fromEntries(
      (runtimeConfigResult.data ?? []).map((item) => [item.key, item.value]),
    );

    return jsonResponse(200, {
      data: {
        checked_at: nowIso,
        traffic: {
          checkout_15m: checkout15m,
          return_15m: return15m,
          active_tenants_15m: activeTenants15m,
          events_24h: recentLogs.length,
        },
        queue: queueSummary,
        leads: leadSummary,
        lead_funnel: leadFunnel,
        traffic_by_hour: Array.from(trafficByHourMap.values()),
        sla: {
          median_latency_ms: medianDuration ?? statusProbeMs,
          p95_latency_ms: p95Duration ?? statusProbeMs,
          error_rate_percent: queueTotal > 0
            ? Number(((queueSummary.failed / queueTotal) * 100).toFixed(2))
            : 0,
          probe_latency_ms: statusProbeMs,
        },
        needs_attention: needsAttention,
        customer_health: customerHealth,
        recent_audit: auditRows.slice(0, 25).map((row) => ({
          id: row.id,
          actor_email: row.actor_email,
          action_type: row.action_type,
          target_type: row.target_type,
          target_id: row.target_id,
          created_at: row.created_at,
        })),
        search_index: searchIndex,
        runtime: runtimeConfig,
        recent_events: recentEvents,
      },
    });
  }

  // ── Subprocessor notice: preview ────────────────────────────────────────────
  return null;
};
