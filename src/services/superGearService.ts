import { invokeEdgeFunction } from "./edgeFunctionClient";
import type { EdgeEnvelope, SuperGearAction } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";

export type SuperGearItem = {
  id: string;
  tenant_id: string;
  name: string;
  barcode: string;
  serial_number: string | null;
  status: string;
  notes: string | null;
};

type SuperGearRequest = {
  action: SuperGearAction;
  payload: Record<string, unknown>;
};

const callSuperGear = async <TData>(payload: SuperGearRequest) => {
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, SuperGearRequest>(
    "super-gear-mutate",
    {
      method: "POST",
      body: payload,
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Super item request failed.");
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
