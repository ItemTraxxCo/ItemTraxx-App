import { invokeEdgeFunction } from "./edgeFunctionClient";
import type { EdgeEnvelope, SuperBorrowerAction } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";

export type SuperBorrowerItem = {
  id: string;
  workspace_id: string;
  username: string;
  borrower_id: string;
  created_at: string;
};

type SuperBorrowerRequest = {
  action: SuperBorrowerAction;
  payload: Record<string, unknown>;
};

const callSuperBorrower = async <TData>(payload: SuperBorrowerRequest) => {
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, SuperBorrowerRequest>(
    "super-borrower-mutate",
    {
      method: "POST",
      body: payload,
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Borrower request failed. Try again.");
  }

  return result.data?.data as TData;
};

export const listSuperBorrowers = async (workspaceId = "all", search = "") =>
  callSuperBorrower<SuperBorrowerItem[]>({
    action: "list",
    payload: { workspace_id: workspaceId, search },
  });

export const createSuperBorrower = async (payload: {
  workspace_id: string;
  username?: string;
  borrower_id?: string;
}) =>
  callSuperBorrower<SuperBorrowerItem>({
    action: "create",
    payload,
  });

export const deleteSuperBorrower = async (payload: {
  id: string;
  super_password: string;
  confirm_phrase: string;
}) =>
  callSuperBorrower<{ success: boolean }>({
    action: "delete",
    payload,
  });
