import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

const TRACKED_STATUSES = new Set(["damaged", "lost", "in_repair", "retired", "in_studio_only"]);

type RpcError = {
  code?: string;
  message?: string;
};

const isMissingRelation = (error: RpcError | null | undefined, relation: string) =>
  !!error &&
  error.code === "42P01" &&
  (error.message ?? "").toLowerCase().includes(relation.toLowerCase());

const isMissingColumn = (error: RpcError | null | undefined, column: string) =>
  !!error &&
  error.code === "42703" &&
  (error.message ?? "").toLowerCase().includes(column.toLowerCase());

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

const resolveMaintenance = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return { enabled: false, message: "" };
  }
  const payload = value as Record<string, unknown>;
  return {
    enabled: payload.enabled === true,
    message:
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : "Maintenance in progress.",
  };
};

const sendReminderEmail = async (
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string
) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Unable to send email.");
  }
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

  try {
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
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (profile.role !== "tenant_admin" && profile.role !== "tenant_user") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: profile.role === "tenant_admin" ? "admin" : "tenant",
        p_limit: profile.role === "tenant_admin" ? 30 : 25,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      return jsonResponse(500, { error: "Rate limit check failed" });
    }

    const rateLimitResult = rateLimit as RateLimitResult;
    if (!rateLimitResult.allowed) {
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    const { action, payload } = await req.json();
    if (typeof action !== "string") {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const tenantId = profile.tenant_id as string;

    const { data: maintenanceRow } = await adminClient
      .from("app_runtime_config")
      .select("value")
      .eq("key", "maintenance_mode")
      .maybeSingle();
    const maintenance = resolveMaintenance(maintenanceRow?.value);

    if (action === "get_notifications") {
      const [
        overdueCountResult,
        statusCountResult,
        recentStatusResult,
        duePolicyResult,
      ] = await Promise.all([
        adminClient
          .from("gear")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "checked_out")
          .lt(
            "checked_out_at",
            new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
          ),
        adminClient
          .from("gear")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .not("status", "in", "(available,checked_out)"),
        adminClient
          .from("gear_status_history")
          .select("id, status, changed_at, gear:gear_id(name, barcode)")
          .eq("tenant_id", tenantId)
          .order("changed_at", { ascending: false })
          .limit(8),
        adminClient
          .from("tenant_policies")
          .select("checkout_due_hours")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
      ]);

      const dueHours = Number(duePolicyResult.data?.checkout_due_hours ?? 72);

      return jsonResponse(200, {
        data: {
          overdue_count: overdueCountResult.error ? 0 : overdueCountResult.count ?? 0,
          flagged_count: statusCountResult.error ? 0 : statusCountResult.count ?? 0,
          due_hours: Number.isFinite(dueHours) && dueHours > 0 ? dueHours : 72,
          maintenance,
          recent_status_events: recentStatusResult.error
            ? []
            : recentStatusResult.data ?? [],
        },
      });
    }

    if (action === "get_status_tracking") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }

      const [flaggedResult, duePolicyResult, historyBaseResult] = await Promise.all([
        adminClient
          .from("gear")
          .select("id, name, barcode, serial_number, status, notes, updated_at, created_at")
          .eq("tenant_id", tenantId)
          .not("status", "in", "(available,checked_out)")
          .order("updated_at", { ascending: false })
          .limit(400),
        adminClient
          .from("tenant_policies")
          .select("checkout_due_hours")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        adminClient
          .from("gear_status_history")
          .select("id, gear_id, status, note, changed_at, changed_by")
          .eq("tenant_id", tenantId)
          .order("changed_at", { ascending: false })
          .limit(600),
      ]);

      let flaggedItems: Array<{
        id: string;
        name: string;
        barcode: string;
        serial_number: string | null;
        status: string;
        notes: string | null;
        updated_at: string;
      }> = [];

      if (flaggedResult.error) {
        if (isMissingColumn(flaggedResult.error as RpcError, "updated_at")) {
          const fallbackFlagged = await adminClient
            .from("gear")
            .select("id, name, barcode, serial_number, status, notes, created_at")
            .eq("tenant_id", tenantId)
            .not("status", "in", "(available,checked_out)")
            .order("created_at", { ascending: false })
            .limit(400);
          if (fallbackFlagged.error) {
            console.error("admin-ops get_status_tracking flagged fallback failed", {
              message: fallbackFlagged.error.message,
              code: fallbackFlagged.error.code,
            });
            return jsonResponse(400, { error: "Unable to load status tracking." });
          }
          flaggedItems = ((fallbackFlagged.data ?? []) as Array<{
            id: string;
            name: string;
            barcode: string;
            serial_number: string | null;
            status: string;
            notes: string | null;
            created_at: string;
          }>).map((item) => ({
            ...item,
            updated_at: item.created_at,
          }));
        } else {
          console.error("admin-ops get_status_tracking flagged query failed", {
            message: flaggedResult.error.message,
            code: flaggedResult.error.code,
          });
          return jsonResponse(400, { error: "Unable to load status tracking." });
        }
      } else {
        flaggedItems = ((flaggedResult.data ?? []) as Array<{
          id: string;
          name: string;
          barcode: string;
          serial_number: string | null;
          status: string;
          notes: string | null;
          updated_at?: string | null;
          created_at?: string | null;
        }>).map((item) => ({
          id: item.id,
          name: item.name,
          barcode: item.barcode,
          serial_number: item.serial_number,
          status: item.status,
          notes: item.notes,
          updated_at: item.updated_at ?? item.created_at ?? new Date().toISOString(),
        }));
      }

      const dueHours = isMissingColumn(duePolicyResult.error as RpcError, "checkout_due_hours")
        ? 72
        : Number(duePolicyResult.data?.checkout_due_hours ?? 72);

      let history: Array<{
        id: string;
        gear_id: string;
        status: string;
        note: string | null;
        changed_at: string;
        changed_by: string | null;
        gear: { name: string; barcode: string } | null;
      }> = [];

      if (historyBaseResult.error) {
        if (!isMissingRelation(historyBaseResult.error as RpcError, "gear_status_history")) {
          console.error("admin-ops get_status_tracking history query failed", {
            message: historyBaseResult.error.message,
            code: historyBaseResult.error.code,
          });
          return jsonResponse(400, { error: "Unable to load status tracking." });
        }
      } else {
        const historyRows = (historyBaseResult.data ?? []) as Array<{
          id: string;
          gear_id: string;
          status: string;
          note: string | null;
          changed_at: string;
          changed_by: string | null;
        }>;
        const gearIds = Array.from(new Set(historyRows.map((row) => row.gear_id)));
        const { data: gearRows } = gearIds.length
          ? await adminClient
              .from("gear")
              .select("id, name, barcode")
              .in("id", gearIds)
          : { data: [] };
        const gearMap = new Map(
          ((gearRows ?? []) as Array<{ id: string; name: string; barcode: string }>).map((row) => [
            row.id,
            { name: row.name, barcode: row.barcode },
          ])
        );
        history = historyRows.map((row) => ({
          ...row,
          gear: gearMap.get(row.gear_id) ?? null,
        }));
      }

      return jsonResponse(200, {
        data: {
          due_hours: Number.isFinite(dueHours) && dueHours > 0 ? dueHours : 72,
          flagged_items: flaggedItems,
          history,
        },
      });
    }

    if (action === "set_due_policy") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      const dueHours = Number((payload ?? {}).checkout_due_hours);
      if (!Number.isFinite(dueHours) || dueHours < 1 || dueHours > 24 * 30) {
        return jsonResponse(400, { error: "Invalid due time limit." });
      }

      const { data, error } = await adminClient
        .from("tenant_policies")
        .upsert(
          {
            tenant_id: tenantId,
            checkout_due_hours: Math.floor(dueHours),
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id" }
        )
        .select("checkout_due_hours")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to save due time limit." });
      }

      return jsonResponse(200, { data });
    }

    if (action === "send_overdue_reminders") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }

      const duePolicyResult = await adminClient
        .from("tenant_policies")
        .select("checkout_due_hours")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const dueHoursRaw = Number(duePolicyResult.data?.checkout_due_hours ?? 72);
      const dueHours = Number.isFinite(dueHoursRaw) && dueHoursRaw > 0 ? dueHoursRaw : 72;

      const { data: overdueRows, error: overdueError } = await adminClient
        .from("gear")
        .select(
          "id, name, barcode, checked_out_at, student:checked_out_by(first_name, last_name, student_id, email)"
        )
        .eq("tenant_id", tenantId)
        .eq("status", "checked_out")
        .lt(
          "checked_out_at",
          new Date(Date.now() - dueHours * 60 * 60 * 1000).toISOString()
        )
        .limit(500);

      if (overdueError) {
        return jsonResponse(400, { error: "Unable to load overdue items." });
      }

      const grouped = new Map<
        string,
        {
          student_name: string;
          student_id: string;
          items: Array<{ name: string; barcode: string; checked_out_at: string | null }>;
        }
      >();

      for (const row of (overdueRows ?? []) as Array<{
        name: string;
        barcode: string;
        checked_out_at: string | null;
        student:
          | {
              first_name: string;
              last_name: string;
              student_id: string;
              email?: string | null;
            }
          | Array<{
              first_name: string;
              last_name: string;
              student_id: string;
              email?: string | null;
            }>
          | null;
      }>) {
        const student = Array.isArray(row.student)
          ? row.student[0] ?? null
          : row.student;
        const email = (student?.email ?? "").trim().toLowerCase();
        if (!email) {
          continue;
        }

        if (!grouped.has(email)) {
          grouped.set(email, {
            student_name: `${student?.first_name ?? ""} ${student?.last_name ?? ""}`.trim(),
            student_id: student?.student_id ?? "",
            items: [],
          });
        }

        grouped.get(email)?.items.push({
          name: row.name,
          barcode: row.barcode,
          checked_out_at: row.checked_out_at,
        });
      }

      if (!grouped.size) {
        return jsonResponse(200, {
          data: { sent: 0, recipients: 0, due_hours: dueHours },
        });
      }

      const resendApiKey = Deno.env.get("ITX_RESEND_API_KEY") ?? "";
      const emailFrom = Deno.env.get("ITX_EMAIL_FROM") ?? "support@itemtraxx.com";

      if (!resendApiKey) {
        return jsonResponse(400, {
          error:
            "Email provider is not configured. Set ITX_RESEND_API_KEY to send reminders.",
        });
      }

      let sent = 0;
      for (const [email, studentData] of grouped) {
        const itemRows = studentData.items
          .map(
            (item) =>
              `<li>${item.name} (${item.barcode}) - checked out ${new Date(
                item.checked_out_at ?? ""
              ).toLocaleString()}</li>`
          )
          .join("");

        const html = `
          <p>Hello ${studentData.student_name || "Student"},</p>
          <p>This is an ItemTraxx reminder that the following item(s) are overdue (limit: ${dueHours} hours):</p>
          <ul>${itemRows}</ul>
          <p>Please return them as soon as possible.</p>
        `;

        try {
          await sendReminderEmail(
            resendApiKey,
            emailFrom,
            email,
            "ItemTraxx overdue gear reminder",
            html
          );
          sent += 1;
        } catch (emailError) {
          console.error("overdue reminder send failed", {
            email,
            message: emailError instanceof Error ? emailError.message : "Unknown error",
          });
        }
      }

      return jsonResponse(200, {
        data: { sent, recipients: grouped.size, due_hours: dueHours },
      });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    console.error("admin-ops function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(JSON.stringify({ error: "Request failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
