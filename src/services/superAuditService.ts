import { invokeEdgeFunction } from "./edgeFunctionClient";
import { supabase } from "./supabaseClient";

export type SuperAuditLog = {
  id: string;
  actor_id: string;
  actor_email: string | null;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type SuperDashboard = {
  total_tenants: number;
  active_tenants: number;
  suspended_tenants: number;
  tenant_admins_count: number;
  recent_actions: SuperAuditLog[];
  tenant_metrics: Array<{
    tenant_id: string;
    tenant_name: string;
    gear_total: number;
    students_total: number;
    active_checkouts: number;
    overdue_items: number;
    transactions_7d: number;
  }>;
  alert_events: Array<{
    id: string;
    name: string;
    metric_key: string;
    threshold: number;
    current: number;
    severity: "warn" | "critical";
  }>;
  runtime_config: Record<string, unknown>;
  pending_approvals: Array<{
    id: string;
    action_type: string;
    status: string;
    created_at: string;
    requested_by: string;
  }>;
  jobs: Array<{
    id: string;
    job_type: string;
    status: string;
    details: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>;
};

const getAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Unauthorized");
  }
  return data.session.access_token;
};

export const fetchSuperDashboard = async () => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<{ data?: SuperDashboard }>(
    "super-dashboard",
    {
      method: "GET",
      accessToken,
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Unable to load super dashboard.");
  }

  return result.data?.data as SuperDashboard;
};
