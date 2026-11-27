import { invokeEdgeFunction } from "./edgeFunctionClient";
import type { EdgeEnvelope, SuperBorrowerAction } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";
import {
  getActiveJitSession,
  getActiveJitTokenForWorkspace,
} from "../store/jitAccessState";

export type SuperBorrowerItem = {
  id: string;
  workspace_id: string;
  username: string;
  borrower_id: string;
  created_at: string;
};

export type SuperBorrowerMetadataItem = {
  id: string;
  workspace_id: string;
  access_mode: string;
  key_version: number | null;
  created_at: string;
  deleted_at: string | null;
};

type SuperBorrowerRequest = {
  action: SuperBorrowerAction;
  payload: Record<string, unknown>;
};

const callSuperBorrower = async <TData>(
  payload: SuperBorrowerRequest,
  jitToken?: string | null,
) => {
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, SuperBorrowerRequest>(
    "super-borrower-mutate",
    {
      method: "POST",
      body: payload,
      ...(jitToken ? { headers: { "x-itx-jit-ticket": jitToken } } : {}),
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Borrower request failed. Try again.");
  }

  return result.data?.data as TData;
};

export const listSuperBorrowerMetadata = async (workspaceId = "all") =>
  callSuperBorrower<SuperBorrowerMetadataItem[]>({
    action: "list_metadata",
    payload: { workspace_id: workspaceId },
  });

export const listSuperBorrowers = async (
  workspaceId = "all",
  search = "",
  jitToken?: string | null,
) =>
  callSuperBorrower<SuperBorrowerItem[]>(
    {
      action: "list",
      payload: { workspace_id: workspaceId, search },
    },
    jitToken ?? (workspaceId !== "all" ? getActiveJitTokenForWorkspace(workspaceId, "read_only") : null),
  );

export const getSuperBorrowerEncryptionMode = async (workspaceId: string) => {
  const data = await callSuperBorrower<{ encrypted: boolean }>({ action: "workspace_mode", payload: { workspace_id: workspaceId } });
  if (typeof data?.encrypted !== "boolean") throw new Error("Unable to determine borrower encryption status.");
  return data.encrypted;
};

export const createSuperBorrower = async (
  payload: {
    workspace_id: string;
    username?: string;
    borrower_id?: string;
    first_name?: string;
    last_name?: string | null;
    email?: string | null;
  },
  jitToken?: string | null,
) =>
  callSuperBorrower<SuperBorrowerItem>(
    {
      action: "create",
      payload,
    },
    jitToken ?? getActiveJitTokenForWorkspace(payload.workspace_id, "break_glass"),
  );

export const deleteSuperBorrower = async (
  payload: {
    id: string;
    super_password: string;
    confirm_phrase: string;
  },
  jitToken?: string | null,
) => {
  const active = getActiveJitSession();
  const resolvedToken = jitToken ?? (active?.ticket.scope === "break_glass" ? active.token : null);
  return callSuperBorrower<{ success: boolean }>(
    {
      action: "delete",
      payload,
    },
    resolvedToken,
  );
};
