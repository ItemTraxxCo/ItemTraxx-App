import { invokeEdgeFunction } from "./edgeFunctionClient";
import { supabase } from "./supabaseClient";

export type SuperGearItem = {
  id: string;
  tenant_id: string;
  name: string;
  barcode: string;
  serial_number: string | null;
  status: string;
  notes: string | null;
};

type SuperGearAction = "list" | "create" | "update" | "delete";

type SuperGearRequest = {
  action: SuperGearAction;
  payload: Record<string, unknown>;
};

const getAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Unauthorized");
  return data.session.access_token;
};

const callSuperGear = async <TData>(payload: SuperGearRequest) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<{ data?: TData }, SuperGearRequest>(
    "super-gear-mutate",
    {
      method: "POST",
      accessToken,
      body: payload,
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Super gear request failed.");
  }

  return result.data?.data as TData;
};

export const listSuperGear = async (tenantId = "all", search = "") =>
  callSuperGear<SuperGearItem[]>({
    action: "list",
    payload: { tenant_id: tenantId, search },
  });

export const createSuperGear = async (payload: {
  tenant_id: string;
  name: string;
  barcode: string;
  serial_number?: string;
  status: string;
  notes?: string;
}) =>
  callSuperGear<SuperGearItem>({
    action: "create",
    payload,
  });

export const updateSuperGear = async (payload: {
  id: string;
  name: string;
  barcode: string;
  status: string;
  notes?: string;
  super_password?: string;
  confirm_phrase?: string;
}) =>
  callSuperGear<SuperGearItem>({
    action: "update",
    payload,
  });

export const deleteSuperGear = async (payload: {
  id: string;
  super_password: string;
  confirm_phrase: string;
}) =>
  callSuperGear<{ success: boolean }>({
    action: "delete",
    payload,
  });
