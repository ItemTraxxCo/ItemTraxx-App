import { invokeEdgeFunction } from "./edgeFunctionClient";
import { supabase } from "./supabaseClient";

export type SuperLogEntry = {
  id: string;
  tenant_id: string;
  gear_id: string;
  checked_out_by: string | null;
  action_type: string;
  action_time: string;
  performed_by: string | null;
  gear: { id: string; name: string; barcode: string } | null;
  student: { id: string; first_name: string; last_name: string; student_id: string } | null;
  tenant: { id: string; name: string } | null;
};

const getAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Unauthorized");
  return data.session.access_token;
};

export const listSuperLogs = async (payload: {
  tenant_id?: string;
  action_type?: string;
  search?: string;
  start_at?: string;
  end_at?: string;
  page?: number;
  page_size?: number;
}) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<{
    data?: SuperLogEntry[];
    page?: number;
    page_size?: number;
    count?: number;
  }>("super-logs-query", {
    method: "POST",
    accessToken,
    body: { payload },
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to load logs.");
  }

  return {
    rows: result.data?.data ?? [],
    page: result.data?.page ?? 1,
    pageSize: result.data?.page_size ?? payload.page_size ?? 50,
    count: result.data?.count ?? 0,
  };
};
