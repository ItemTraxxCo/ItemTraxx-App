import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

type RuntimeUpdateItem = {
  id: string;
  title: string;
  message: string;
  level: "info" | "warning" | "critical";
  created_at: string;
  link_url: string | null;
};

type TenantFeatureFlags = {
  enable_notifications: boolean;
  enable_bulk_item_import: boolean;
  enable_bulk_student_tools: boolean;
  enable_status_tracking: boolean;
  enable_barcode_generator: boolean;
};

type DeviceSessionContext = {
  deviceId: string | null;
  deviceLabel: string | null;
  userAgent: string | null;
};

const TRACKED_STATUSES = new Set(["damaged", "lost", "in_repair", "retired", "in_studio_only"]);
const ALLOWED_GEAR_STATUSES = new Set([
  "available",
  "checked_out",
  "damaged",
  "lost",
  "in_repair",
  "retired",
  "in_studio_only",
]);

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

const defaultFeatureFlags = (): TenantFeatureFlags => ({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_student_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});

const normalizeFeatureFlags = (value: unknown): TenantFeatureFlags => {
  if (!value || typeof value !== "object") return defaultFeatureFlags();
  const payload = value as Record<string, unknown>;
  const fallback = defaultFeatureFlags();
  return {
    enable_notifications:
      typeof payload.enable_notifications === "boolean"
        ? payload.enable_notifications
        : fallback.enable_notifications,
    enable_bulk_item_import:
      typeof payload.enable_bulk_item_import === "boolean"
        ? payload.enable_bulk_item_import
        : fallback.enable_bulk_item_import,
    enable_bulk_student_tools:
      typeof payload.enable_bulk_student_tools === "boolean"
        ? payload.enable_bulk_student_tools
        : fallback.enable_bulk_student_tools,
    enable_status_tracking:
      typeof payload.enable_status_tracking === "boolean"
        ? payload.enable_status_tracking
        : fallback.enable_status_tracking,
    enable_barcode_generator:
      typeof payload.enable_barcode_generator === "boolean"
        ? payload.enable_barcode_generator
        : fallback.enable_barcode_generator,
  };
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

const sanitizeText = (value: unknown, maxLen: number) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
};

const resolveDeviceSessionContext = (
  payload: Record<string, unknown>,
  req: Request
): DeviceSessionContext => ({
  deviceId: sanitizeText(payload.device_id, 128),
  deviceLabel: sanitizeText(payload.device_label, 160),
  userAgent: sanitizeText(req.headers.get("user-agent"), 255),
});

const isMissingSessionTable = (error: RpcError | null | undefined) =>
  isMissingRelation(error, "tenant_admin_sessions");


serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
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
      .select("tenant_id, role, is_active")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      return jsonResponse(403, { error: "Access denied" });
    }

    if (profile.role !== "tenant_admin" && profile.role !== "tenant_user") {
      return jsonResponse(403, { error: "Access denied" });
    }
    if (profile.role === "tenant_admin" && profile.is_active === false) {
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
    const payloadRecord =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const isSessionAction =
      action === "touch_session" ||
      action === "validate_session" ||
      action === "list_sessions" ||
      action === "revoke_session" ||
      action === "revoke_all_sessions";

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const tenantId = profile.tenant_id as string;
    const { data: tenantStatus } = await userClient
      .from("tenants")
      .select("status")
      .eq("id", tenantId)
      .maybeSingle();
    const isTenantSuspended = tenantStatus?.status === "suspended";
    const deviceSession = resolveDeviceSessionContext(payloadRecord, req);

    const findActiveSession = async () => {
      if (!deviceSession.deviceId) {
        return { exists: false as const, relationMissing: false };
      }
      const { data, error } = await adminClient
        .from("tenant_admin_sessions")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .eq("device_id", deviceSession.deviceId)
        .is("revoked_at", null)
        .limit(1)
        .maybeSingle();
      if (error) {
        if (isMissingSessionTable(error as RpcError)) {
          return { exists: false as const, relationMissing: true as const };
        }
        throw new Error("Unable to validate admin session.");
      }
      return { exists: !!data, relationMissing: false as const };
    };

    const touchCurrentSession = async () => {
      if (!deviceSession.deviceId) {
        return { ok: false as const, relationMissing: false as const, reason: "missing_device" };
      }
      const now = new Date().toISOString();
      const { data: existing, error: existingError } = await adminClient
        .from("tenant_admin_sessions")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .eq("device_id", deviceSession.deviceId)
        .is("revoked_at", null)
        .limit(1)
        .maybeSingle();
      if (existingError) {
        if (isMissingSessionTable(existingError as RpcError)) {
          return { ok: false as const, relationMissing: true as const, reason: "missing_table" };
        }
        throw new Error("Unable to register admin session.");
      }

      if (existing?.id) {
        const { error: updateError } = await adminClient
          .from("tenant_admin_sessions")
          .update({
            last_seen_at: now,
            device_label: deviceSession.deviceLabel,
            user_agent: deviceSession.userAgent,
          })
          .eq("id", existing.id);
        if (updateError) {
          throw new Error("Unable to update admin session.");
        }
      } else {
        const { error: insertError } = await adminClient
          .from("tenant_admin_sessions")
          .insert({
            tenant_id: tenantId,
            profile_id: user.id,
            device_id: deviceSession.deviceId,
            device_label: deviceSession.deviceLabel,
            user_agent: deviceSession.userAgent,
            created_at: now,
            last_seen_at: now,
          });
        if (insertError) {
          if (isMissingSessionTable(insertError as RpcError)) {
            return { ok: false as const, relationMissing: true as const, reason: "missing_table" };
          }
          throw new Error("Unable to register admin session.");
        }
      }

      return { ok: true as const, relationMissing: false as const, reason: "ok" };
    };

    if (profile.role === "tenant_admin" && !isSessionAction) {
      const activeSession = await findActiveSession();
      if (!activeSession.relationMissing && !activeSession.exists) {
        return jsonResponse(401, { error: "Session revoked" });
      }
    }

    const [maintenanceRuntimeResult, updateRuntimeResult] = await Promise.all([
      adminClient
        .from("app_runtime_config")
        .select("value")
        .eq("key", "maintenance_mode")
        .maybeSingle(),
      adminClient
        .from("app_runtime_config")
        .select("value")
        .eq("key", "tenant_updates")
        .maybeSingle(),
    ]);
    const maintenance = resolveMaintenance(maintenanceRuntimeResult.data?.value);

    let checkoutDueHours = 72;
    let featureFlags = defaultFeatureFlags();
    const tenantPolicyResult = await adminClient
      .from("tenant_policies")
      .select("checkout_due_hours, feature_flags")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!tenantPolicyResult.error && tenantPolicyResult.data) {
      if (typeof tenantPolicyResult.data.checkout_due_hours === "number") {
        checkoutDueHours = Math.min(
          720,
          Math.max(1, Math.round(tenantPolicyResult.data.checkout_due_hours))
        );
      }
      featureFlags = normalizeFeatureFlags(tenantPolicyResult.data.feature_flags);
    }

    let tenantUpdates: RuntimeUpdateItem[] = [];
    const updateRuntimeValue = updateRuntimeResult.data?.value;
    if (updateRuntimeValue && typeof updateRuntimeValue === "object") {
      const payload = updateRuntimeValue as Record<string, unknown>;
      const enabled = payload.enabled !== false;
      if (enabled && Array.isArray(payload.items)) {
        tenantUpdates = payload.items
          .filter((item) => item && typeof item === "object")
          .map((item, index) => {
            const row = item as Record<string, unknown>;
            const message = typeof row.message === "string" ? row.message.trim() : "";
            const title = typeof row.title === "string" ? row.title.trim() : "";
            if (!message) return null;
            const level =
              row.level === "warning" || row.level === "critical"
                ? row.level
                : "info";
            const createdAt =
              typeof row.created_at === "string" && row.created_at
                ? row.created_at
                : new Date().toISOString();
            const id =
              typeof row.id === "string" && row.id
                ? row.id
                : `${createdAt}-${index}`;
            return {
              id,
              title: title || "Product update",
              message,
              level,
              created_at: createdAt,
              link_url:
                typeof row.link_url === "string" && row.link_url.trim()
                  ? row.link_url.trim()
                  : null,
            } as RuntimeUpdateItem;
          })
          .filter((item): item is RuntimeUpdateItem => !!item)
          .slice(0, 5);
      }
    }

    if (action === "get_notifications") {
      const dueCutoffIso = new Date(
        Date.now() - checkoutDueHours * 60 * 60 * 1000
      ).toISOString();

      const [statusCountResult, recentStatusResult, overdueCountResult] =
        await Promise.all([
          adminClient
            .from("gear")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .not("status", "in", "(available,checked_out)"),
          adminClient
            .from("gear_status_history")
            .select("id, status, changed_at, gear:gear_id(name, barcode)")
            .eq("tenant_id", tenantId)
            .order("changed_at", { ascending: false })
            .limit(8),
          adminClient
            .from("gear")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .not("checked_out_by", "is", null)
            .lte("checked_out_at", dueCutoffIso),
        ]);

      return jsonResponse(200, {
        data: {
          overdue_count: overdueCountResult.error ? 0 : overdueCountResult.count ?? 0,
          flagged_count: statusCountResult.error ? 0 : statusCountResult.count ?? 0,
          maintenance,
          recent_status_events: recentStatusResult.error ? [] : recentStatusResult.data ?? [],
          updates: tenantUpdates,
          checkout_due_hours: checkoutDueHours,
          feature_flags: featureFlags,
        },
      });
    }

    if (action === "get_tenant_settings") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }

      return jsonResponse(200, {
        data: {
          checkout_due_hours: checkoutDueHours,
          feature_flags: featureFlags,
        },
      });
    }

    if (action === "update_tenant_settings") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      if (isTenantSuspended) {
        return jsonResponse(403, { error: "Tenant disabled" });
      }

      const next = payloadRecord;
      const checkoutDueHoursRaw = Number(next.checkout_due_hours);
      if (!Number.isFinite(checkoutDueHoursRaw)) {
        return jsonResponse(400, { error: "Invalid checkout due hours." });
      }

      const checkoutDueHoursNext = Math.min(
        720,
        Math.max(1, Math.round(checkoutDueHoursRaw))
      );

      const row = {
        tenant_id: tenantId,
        checkout_due_hours: checkoutDueHoursNext,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await adminClient
        .from("tenant_policies")
        .upsert(row, { onConflict: "tenant_id" })
        .select("checkout_due_hours, feature_flags")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to save tenant settings." });
      }

      return jsonResponse(200, {
        data: {
          checkout_due_hours:
            typeof data.checkout_due_hours === "number"
              ? data.checkout_due_hours
              : checkoutDueHoursNext,
          feature_flags: normalizeFeatureFlags(data.feature_flags),
        },
      });
    }

    if (action === "get_status_tracking") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }

      const [flaggedResult, historyBaseResult] = await Promise.all([
        adminClient
          .from("gear")
          .select("id, name, barcode, serial_number, status, notes, updated_at, created_at")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .not("status", "in", "(available,checked_out)")
          .order("updated_at", { ascending: false })
          .limit(400),
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
            .is("deleted_at", null)
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
          ? await adminClient.from("gear").select("id, name, barcode").in("id", gearIds)
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
          flagged_items: flaggedItems,
          history,
        },
      });
    }

    if (action === "touch_session") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      const touch = await touchCurrentSession();
      if (touch.relationMissing) {
        return jsonResponse(400, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!touch.ok) {
        return jsonResponse(400, { error: "Device session is required." });
      }
      return jsonResponse(200, { data: { ok: true } });
    }

    if (action === "validate_session") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      if (!deviceSession.deviceId) {
        return jsonResponse(400, { error: "Device session is required." });
      }
      const activeSession = await findActiveSession();
      if (activeSession.relationMissing) {
        return jsonResponse(400, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!activeSession.exists) {
        return jsonResponse(200, { data: { valid: false } });
      }
      const touch = await touchCurrentSession();
      if (!touch.ok && !touch.relationMissing) {
        return jsonResponse(400, { error: "Unable to refresh admin session." });
      }
      return jsonResponse(200, { data: { valid: true } });
    }

    if (action === "list_sessions") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      const { data, error } = await adminClient
        .from("tenant_admin_sessions")
        .select("id, device_id, device_label, user_agent, created_at, last_seen_at")
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(100);
      if (error) {
        if (isMissingSessionTable(error as RpcError)) {
          return jsonResponse(400, {
            error: "Session controls unavailable. Run latest SQL setup.",
          });
        }
        return jsonResponse(400, { error: "Unable to load active devices." });
      }
      const rows = (data ?? []) as Array<{
        id: string;
        device_id: string;
        device_label: string | null;
        user_agent: string | null;
        created_at: string;
        last_seen_at: string;
      }>;
      return jsonResponse(200, {
        data: {
          sessions: rows.map((row) => ({
            ...row,
            is_current: !!deviceSession.deviceId && row.device_id === deviceSession.deviceId,
          })),
        },
      });
    }

    if (action === "revoke_session") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      if (isTenantSuspended) {
        return jsonResponse(403, { error: "Tenant disabled" });
      }
      const sessionId = sanitizeText(payloadRecord.session_id, 128);
      if (!sessionId) {
        return jsonResponse(400, { error: "Session id is required." });
      }
      const { data: revokedRows, error } = await adminClient
        .from("tenant_admin_sessions")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: user.id,
        })
        .eq("id", sessionId)
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .is("revoked_at", null)
        .select("id");
      if (error) {
        if (isMissingSessionTable(error as RpcError)) {
          return jsonResponse(400, {
            error: "Session controls unavailable. Run latest SQL setup.",
          });
        }
        return jsonResponse(400, { error: "Unable to revoke session." });
      }
      if (!revokedRows?.length) {
        return jsonResponse(404, { error: "Session not found." });
      }
      return jsonResponse(200, { data: { revoked: true } });
    }

    if (action === "revoke_all_sessions") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      if (isTenantSuspended) {
        return jsonResponse(403, { error: "Tenant disabled" });
      }
      const signOutCurrent = payloadRecord.sign_out_current === true;
      let query = adminClient
        .from("tenant_admin_sessions")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: user.id,
        })
        .eq("tenant_id", tenantId)
        .eq("profile_id", user.id)
        .is("revoked_at", null);
      if (!signOutCurrent && deviceSession.deviceId) {
        query = query.neq("device_id", deviceSession.deviceId);
      }
      const { data, error } = await query.select("id");
      if (error) {
        if (isMissingSessionTable(error as RpcError)) {
          return jsonResponse(400, {
            error: "Session controls unavailable. Run latest SQL setup.",
          });
        }
        return jsonResponse(400, { error: "Unable to revoke sessions." });
      }
      return jsonResponse(200, {
        data: {
          revoked: (data ?? []).length,
        },
      });
    }

    if (action === "bulk_import_gear") {
      if (profile.role !== "tenant_admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      if (isTenantSuspended) {
        return jsonResponse(403, { error: "Tenant disabled" });
      }

      const rawRows = Array.isArray(payloadRecord.rows)
        ? (payloadRecord.rows as Array<Record<string, unknown>>)
        : [];

      if (!rawRows.length || rawRows.length > 1000) {
        return jsonResponse(400, { error: "Provide between 1 and 1000 rows." });
      }

      const skippedRows: Array<{ barcode: string; reason: string }> = [];
      const normalizedRows: Array<{
        name: string;
        barcode: string;
        serial_number: string | null;
        status: string;
        notes: string | null;
      }> = [];

      const seenBarcodes = new Set<string>();

      for (const row of rawRows) {
        const name = typeof row.name === "string" ? row.name.trim() : "";
        const barcode = typeof row.barcode === "string" ? row.barcode.trim() : "";
        const serial = typeof row.serial_number === "string" ? row.serial_number.trim() : "";
        const statusRaw = typeof row.status === "string" ? row.status.trim() : "available";
        const notes = typeof row.notes === "string" ? row.notes.trim() : "";

        if (!name || !barcode) {
          skippedRows.push({ barcode: barcode || "(blank)", reason: "Missing name or barcode." });
          continue;
        }
        if (name.length > 120 || barcode.length > 64 || serial.length > 64 || notes.length > 500) {
          skippedRows.push({ barcode, reason: "Field length exceeded." });
          continue;
        }
        if (!ALLOWED_GEAR_STATUSES.has(statusRaw)) {
          skippedRows.push({ barcode, reason: "Invalid status." });
          continue;
        }
        if (seenBarcodes.has(barcode.toLowerCase())) {
          skippedRows.push({ barcode, reason: "Duplicate barcode in import." });
          continue;
        }

        seenBarcodes.add(barcode.toLowerCase());
        normalizedRows.push({
          name,
          barcode,
          serial_number: serial || null,
          status: statusRaw,
          notes: notes || null,
        });
      }

      if (!normalizedRows.length) {
        return jsonResponse(200, {
          data: {
            inserted: 0,
            skipped: skippedRows.length,
            inserted_items: [],
            skipped_rows: skippedRows,
          },
        });
      }

      const lookupBarcodes = normalizedRows.map((row) => row.barcode);
      const { data: existingRows } = await adminClient
        .from("gear")
        .select("barcode")
        .eq("tenant_id", tenantId)
        .in("barcode", lookupBarcodes);
      const existing = new Set((existingRows ?? []).map((row) => (row as { barcode: string }).barcode));

      const toInsert = normalizedRows.filter((row) => {
        const isExisting = existing.has(row.barcode);
        if (isExisting) {
          skippedRows.push({ barcode: row.barcode, reason: "Barcode already exists." });
        }
        return !isExisting;
      });

      if (!toInsert.length) {
        return jsonResponse(200, {
          data: {
            inserted: 0,
            skipped: skippedRows.length,
            inserted_items: [],
            skipped_rows: skippedRows,
          },
        });
      }

      const insertPayload = toInsert.map((row) => ({
        tenant_id: tenantId,
        name: row.name,
        barcode: row.barcode,
        serial_number: row.serial_number,
        status: row.status,
        notes: row.notes,
      }));

      const { data: insertedRows, error: insertError } = await adminClient
        .from("gear")
        .insert(insertPayload)
        .select("id, tenant_id, name, barcode, serial_number, status, notes");

      if (insertError) {
        return jsonResponse(400, { error: "Unable to import item rows." });
      }

      const historyPayload = (insertedRows ?? [])
        .filter((item) => TRACKED_STATUSES.has((item as { status: string }).status))
        .map((item) => ({
          tenant_id: tenantId,
          gear_id: (item as { id: string }).id,
          status: (item as { status: string }).status,
          note: (item as { notes?: string | null }).notes ?? null,
          changed_by: user.id,
        }));
      if (historyPayload.length) {
        await adminClient.from("gear_status_history").insert(historyPayload);
      }

      return jsonResponse(200, {
        data: {
          inserted: (insertedRows ?? []).length,
          skipped: skippedRows.length,
          inserted_items: insertedRows ?? [],
          skipped_rows: skippedRows,
        },
      });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    console.error("admin-ops function error", {
      request_id: requestId,
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
