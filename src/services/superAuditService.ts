import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";

type SuperAuditLog = {
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
  total_workspaces: number;
  active_workspaces: number;
  suspended_workspaces: number;
  workspace_admins_count: number;
  recent_actions: SuperAuditLog[];
  workspace_metrics: Array<{
    workspace_id: string;
    workspace_name: string;
    item_total: number;
    borrowers_total: number;
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

export const fetchSuperDashboard = async () => {
  const result = await invokeEdgeFunction<{ data?: SuperDashboard }>(
    "super-dashboard",
    {
      method: "GET",
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to load super dashboard. fix yo code.");
  }

  return result.data?.data as SuperDashboard;
};
