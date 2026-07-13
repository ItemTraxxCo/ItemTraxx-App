import { callSuperOps } from "./client";
import type { SuperAlertRule, SuperApproval, SuperControlCenter, SuperJob } from "./types";

export type { SuperAlertRule, SuperApproval, SuperControlCenter, SuperJob } from "./types";

export const getControlCenter = async () =>
  callSuperOps<SuperControlCenter>({
    action: "get_control_center",
    payload: {},
  });

export const setRuntimeConfig = async (payload: {
  key: string;
  value: Record<string, unknown>;
}) =>
  callSuperOps<{ key: string; value: Record<string, unknown> }>({
    action: "set_runtime_config",
    payload,
  });

export const upsertAlertRule = async (payload: {
  id?: string;
  name: string;
  metric_key: string;
  threshold: number;
  is_enabled: boolean;
}) =>
  callSuperOps<SuperAlertRule>({
    action: "upsert_alert_rule",
    payload,
  });

export const forceTenantReauth = async (payload: { tenant_id: string }) =>
  callSuperOps<{ success: boolean; job: SuperJob | null }>({
    action: "set_tenant_force_reauth",
    payload,
  });

export const setTenantPolicy = async (payload: {
  tenant_id: string;
  checkout_due_hours: number;
  feature_flags: {
    enable_notifications: boolean;
    enable_bulk_item_import: boolean;
    enable_bulk_student_tools: boolean;
    enable_status_tracking: boolean;
    enable_barcode_generator: boolean;
  };
}) =>
  callSuperOps<{
    tenant_id: string;
    checkout_due_hours: number;
    feature_flags: Record<string, unknown>;
  }>({
    action: "set_tenant_policy",
    payload,
  });

export const approveRequest = async (payload: { id: string }) =>
  callSuperOps<SuperApproval>({
    action: "approve_request",
    payload,
  });
