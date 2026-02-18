import { invokeEdgeFunction } from "./edgeFunctionClient";
import { supabase } from "./supabaseClient";

export type RuntimeConfigMap = Record<string, unknown>;

export type SuperAlertRule = {
  id: string;
  name: string;
  metric_key: string;
  threshold: number;
  is_enabled: boolean;
  created_at: string;
};

export type SuperApproval = {
  id: string;
  action_type: string;
  payload: Record<string, unknown>;
  requested_by: string;
  approved_by: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
};

export type SuperJob = {
  id: string;
  job_type: string;
  status: string;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type SuperOpsAction =
  | "get_control_center"
  | "set_runtime_config"
  | "upsert_alert_rule"
  | "set_tenant_policy"
  | "set_tenant_force_reauth"
  | "create_approval"
  | "approve_request";

type SuperOpsRequest = {
  action: SuperOpsAction;
  payload: Record<string, unknown>;
};

const getAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Unauthorized");
  }
  return data.session.access_token;
};

const callSuperOps = async <TData>(payload: SuperOpsRequest) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<{ data?: TData }, SuperOpsRequest>(
    "super-ops",
    {
      method: "POST",
      accessToken,
      body: payload,
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Super ops request failed.");
  }

  return result.data?.data as TData;
};

export type SuperControlCenter = {
  runtime_config: RuntimeConfigMap;
  alert_rules: SuperAlertRule[];
  approvals: SuperApproval[];
  jobs: SuperJob[];
};

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

export const approveRequest = async (payload: { id: string }) =>
  callSuperOps<SuperApproval>({
    action: "approve_request",
    payload,
  });
