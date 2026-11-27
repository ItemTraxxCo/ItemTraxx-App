import { invokeEdgeFunction } from "./edgeFunctionClient";
import type { EdgeEnvelope, SuperItemAction } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";
import {
  getActiveJitSession,
  getActiveJitTokenForWorkspace,
} from "../store/jitAccessState";

export type SuperItemRecord = {
  id: string;
  workspace_id: string;
  name: string;
  barcode: string;
  serial_number: string | null;
  status: string;
  notes: string | null;
};

export type SuperItemMetadataRecord = {
  id: string;
  workspace_id: string;
  status: string;
  created_at: string;
};

type SuperItemRequest = {
  action: SuperItemAction;
  payload: Record<string, unknown>;
};

const callSuperItem = async <TData>(
  payload: SuperItemRequest,
  jitToken?: string | null,
) => {
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, SuperItemRequest>(
    "super-item-mutate",
    {
      method: "POST",
      body: payload,
      ...(jitToken ? { headers: { "x-itx-jit-ticket": jitToken } } : {}),
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Super item request failed. fix yo code.");
  }

  return result.data?.data as TData;
};

export const listSuperItemMetadata = async (workspaceId = "all") =>
  callSuperItem<SuperItemMetadataRecord[]>({
    action: "list_metadata",
    payload: { workspace_id: workspaceId },
  });

export const listSuperItem = async (
  workspaceId = "all",
  search = "",
  jitToken?: string | null,
) =>
  callSuperItem<SuperItemRecord[]>(
    {
      action: "list",
      payload: { workspace_id: workspaceId, search },
    },
    jitToken ?? (workspaceId !== "all" ? getActiveJitTokenForWorkspace(workspaceId, "read_only") : null),
  );

export const createSuperItem = async (
  payload: {
    workspace_id: string;
    name: string;
    barcode: string;
    serial_number?: string;
    status: string;
    notes?: string;
  },
  jitToken?: string | null,
) =>
  callSuperItem<SuperItemRecord>(
    {
      action: "create",
      payload,
    },
    jitToken ?? getActiveJitTokenForWorkspace(payload.workspace_id, "break_glass"),
  );

export const updateSuperItem = async (
  payload: {
    id: string;
    name: string;
    barcode: string;
    status: string;
    notes?: string;
    super_password?: string;
    confirm_phrase?: string;
  },
  jitToken?: string | null,
) => {
  const active = getActiveJitSession();
  const resolvedToken = jitToken ?? (active?.ticket.scope === "break_glass" ? active.token : null);
  return callSuperItem<SuperItemRecord>(
    {
      action: "update",
      payload,
    },
    resolvedToken,
  );
};

export const deleteSuperItem = async (
  payload: {
    id: string;
    super_password: string;
    confirm_phrase: string;
  },
  jitToken?: string | null,
) => {
  const active = getActiveJitSession();
  const resolvedToken = jitToken ?? (active?.ticket.scope === "break_glass" ? active.token : null);
  return callSuperItem<{ success: boolean }>(
    {
      action: "delete",
      payload,
    },
    resolvedToken,
  );
};
