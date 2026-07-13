import {
  optionalInteger,
  optionalJsonObject,
  optionalPositiveInteger,
  optionalText,
  requireText,
  requireUuid,
} from "../../_shared/validation.ts";
import type { SuperOpsContext } from "../context.ts";

export const CONTROL_CENTER_ACTIONS = [
  "get_control_center",
  "set_runtime_config",
  "upsert_alert_rule",
  "set_tenant_policy",
  "set_tenant_force_reauth",
  "create_approval",
  "approve_request",
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const handleControlCenterAction = async (
  context: SuperOpsContext,
): Promise<Response | null> => {
  const { action, payload, adminClient, user, jsonResponse, writeAudit } =
    context;

  if (action === "get_control_center") {
    const [
      runtimeConfigResult,
      alertRulesResult,
      approvalsResult,
      jobsResult,
    ] = await Promise.all([
      adminClient.from("app_runtime_config").select("key, value"),
      adminClient
        .from("super_alert_rules")
        .select("id, name, metric_key, threshold, is_enabled, created_at")
        .order("created_at", { ascending: false }),
      adminClient
        .from("super_approvals")
        .select(
          "id, action_type, payload, requested_by, approved_by, status, created_at, decided_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      adminClient
        .from("super_jobs")
        .select("id, job_type, status, details, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);

    if (
      runtimeConfigResult.error || alertRulesResult.error ||
      approvalsResult.error || jobsResult.error
    ) {
      return jsonResponse(400, { error: "Unable to load control center." });
    }

    const runtimeConfig = Object.fromEntries(
      (runtimeConfigResult.data ?? []).map((item) => [item.key, item.value]),
    );

    return jsonResponse(200, {
      data: {
        runtime_config: runtimeConfig,
        alert_rules: alertRulesResult.data ?? [],
        approvals: approvalsResult.data ?? [],
        jobs: jobsResult.data ?? [],
      },
    });
  }

  if (action === "set_runtime_config") {
    const next = payload;
    const key = requireText(next.key, { maxLen: 120 });
    const value = optionalJsonObject(next.value, 25_000);

    const { data, error } = await adminClient
      .from("app_runtime_config")
      .upsert({
        key,
        value,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" })
      .select("key, value")
      .single();

    if (error || !data) {
      return jsonResponse(400, { error: "Unable to save runtime config." });
    }

    await writeAudit("set_runtime_config", "config", key, { key });

    return jsonResponse(200, { data });
  }

  if (action === "upsert_alert_rule") {
    const next = payload;
    const id = optionalText(next.id, { maxLen: 36 });
    if (id && !UUID_PATTERN.test(id)) {
      return jsonResponse(400, { error: "Invalid request" });
    }
    const name = requireText(next.name, { maxLen: 120 });
    const metricKey = requireText(next.metric_key, { maxLen: 120 });
    const threshold = Number(next.threshold);
    const isEnabled = next.is_enabled !== false;
    if (!Number.isFinite(threshold)) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const payloadRow = {
      ...(id ? { id } : {}),
      name,
      metric_key: metricKey,
      threshold,
      is_enabled: isEnabled,
      created_by: user.id,
    };

    const { data, error } = await adminClient
      .from("super_alert_rules")
      .upsert(payloadRow)
      .select("id, name, metric_key, threshold, is_enabled, created_at")
      .single();

    if (error || !data) {
      return jsonResponse(400, { error: "Unable to save alert rule." });
    }

    await writeAudit("upsert_alert_rule", "alert_rule", data.id, {
      metric_key: data.metric_key,
      threshold: data.threshold,
    });

    return jsonResponse(200, { data });
  }

  if (action === "set_tenant_policy") {
    const next = payload;
    const tenantId = requireUuid(next.tenant_id);

    const row = {
      tenant_id: tenantId,
      max_admins: optionalPositiveInteger(next.max_admins, 1000),
      max_students: optionalPositiveInteger(next.max_students, 100_000),
      max_gear: optionalPositiveInteger(next.max_gear, 100_000),
      checkout_due_hours: optionalInteger(
        next.checkout_due_hours,
        1,
        720,
        72,
      ),
      barcode_pattern: optionalText(next.barcode_pattern, { maxLen: 80 }) ||
        null,
      feature_flags: optionalJsonObject(next.feature_flags, 10_000),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await adminClient
      .from("tenant_policies")
      .upsert(row, { onConflict: "tenant_id" })
      .select(
        "tenant_id, max_admins, max_students, max_gear, checkout_due_hours, barcode_pattern, feature_flags",
      )
      .single();

    if (error || !data) {
      const message = (error?.message ?? "").toLowerCase();
      if (
        error?.code === "42703" &&
        (message.includes("feature_flags") ||
          message.includes("account_category") ||
          message.includes("plan_code"))
      ) {
        const { data: fallbackData, error: fallbackError } = await adminClient
          .from("tenant_policies")
          .upsert(
            {
              tenant_id: tenantId,
              max_admins: row.max_admins,
              max_students: row.max_students,
              max_gear: row.max_gear,
              checkout_due_hours: row.checkout_due_hours,
              barcode_pattern: row.barcode_pattern,
              updated_by: row.updated_by,
              updated_at: row.updated_at,
            },
            { onConflict: "tenant_id" },
          )
          .select(
            "tenant_id, max_admins, max_students, max_gear, checkout_due_hours, barcode_pattern",
          )
          .single();
        if (fallbackError || !fallbackData) {
          return jsonResponse(400, {
            error: "Unable to save tenant policy.",
          });
        }
        await writeAudit(
          "set_tenant_policy",
          "tenant_policy",
          tenantId,
          fallbackData as Record<string, unknown>,
        );
        return jsonResponse(200, { data: fallbackData });
      }
      return jsonResponse(400, { error: "Unable to save tenant policy." });
    }

    await writeAudit(
      "set_tenant_policy",
      "tenant_policy",
      tenantId,
      data as Record<string, unknown>,
    );
    return jsonResponse(200, { data });
  }

  if (action === "set_tenant_force_reauth") {
    const next = payload;
    const tenantId = requireUuid(next.tenant_id);

    const forceAt = new Date().toISOString();
    const { error } = await adminClient
      .from("tenant_security_controls")
      .upsert({
        tenant_id: tenantId,
        force_reauth_after: forceAt,
        updated_by: user.id,
        updated_at: forceAt,
      }, { onConflict: "tenant_id" });

    if (error) {
      return jsonResponse(400, { error: "Unable to force tenant re-login." });
    }

    const { data: job } = await adminClient
      .from("super_jobs")
      .insert({
        job_type: "force_tenant_reauth",
        status: "completed",
        details: { tenant_id: tenantId, force_reauth_after: forceAt },
        created_by: user.id,
      })
      .select("id, job_type, status, details, created_at, updated_at")
      .single();

    await writeAudit("force_tenant_reauth", "tenant", tenantId, {
      force_reauth_after: forceAt,
    });

    return jsonResponse(200, { data: { success: true, job } });
  }

  if (action === "create_approval") {
    const next = payload;
    const actionType = requireText(next.action_type, { maxLen: 120 });
    const approvalPayload = optionalJsonObject(next.payload, 25_000);

    const { data, error } = await adminClient
      .from("super_approvals")
      .insert({
        action_type: actionType,
        payload: approvalPayload,
        requested_by: user.id,
        status: "pending",
      })
      .select("id, action_type, payload, requested_by, status, created_at")
      .single();

    if (error || !data) {
      return jsonResponse(400, {
        error: "Unable to create approval request.",
      });
    }

    await writeAudit("create_approval", "approval", data.id, {
      action_type: actionType,
    });

    return jsonResponse(200, { data });
  }

  if (action === "approve_request") {
    const next = payload;
    const id = requireUuid(next.id);

    const { data: approval, error: approvalError } = await adminClient
      .from("super_approvals")
      .select("id, requested_by, status")
      .eq("id", id)
      .single();

    if (approvalError || !approval?.id) {
      return jsonResponse(400, { error: "Approval request not found." });
    }
    if (approval.requested_by === user.id) {
      return jsonResponse(403, { error: "Requester cannot self-approve." });
    }
    if (approval.status !== "pending") {
      return jsonResponse(400, {
        error: "Approval request is already resolved.",
      });
    }

    const { data, error } = await adminClient
      .from("super_approvals")
      .update({
        status: "approved",
        approved_by: user.id,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(
        "id, action_type, payload, requested_by, approved_by, status, created_at, decided_at",
      )
      .single();

    if (error || !data) {
      return jsonResponse(400, { error: "Unable to approve request." });
    }

    await writeAudit("approve_request", "approval", id, {});
    return jsonResponse(200, { data });
  }

  return null;
};
