import { invokeEdgeFunction } from "./edgeFunctionClient";
import type { EdgeEnvelope, SuperItemAction } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";

export type SuperItemRecord = {
  id: string;
  workspace_id: string;
  name: string;
  barcode: string;
  serial_number: string | null;
  status: string;
  notes: string | null;
};

type SuperItemRequest = {
  action: SuperItemAction;
  payload: Record<string, unknown>;
};

const callSuperItem = async <TData>(payload: SuperItemRequest) => {
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, SuperItemRequest>(
    "super-item-mutate",
    {
      method: "POST",
      body: payload,
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Super item request failed. fix yo code.");
  }

  return result.data?.data as TData;
};

export const listSuperItem = async (workspaceId = "all", search = "") =>
  callSuperItem<SuperItemRecord[]>({
    action: "list",
    payload: { workspace_id: workspaceId, search },
  });

export const createSuperItem = async (payload: {
  workspace_id: string;
  name: string;
  barcode: string;
  serial_number?: string;
  status: string;
  notes?: string;
}) =>
  callSuperItem<SuperItemRecord>({
    action: "create",
    payload,
  });

export const updateSuperItem = async (payload: {
  id: string;
  name: string;
  barcode: string;
  status: string;
  notes?: string;
  super_password?: string;
  confirm_phrase?: string;
}) =>
  callSuperItem<SuperItemRecord>({
    action: "update",
    payload,
  });

export const deleteSuperItem = async (payload: {
  id: string;
  super_password: string;
  confirm_phrase: string;
}) =>
  callSuperItem<{ success: boolean }>({
    action: "delete",
    payload,
  });
