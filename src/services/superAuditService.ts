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
