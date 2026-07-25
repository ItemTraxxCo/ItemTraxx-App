import { invokeEdgeFunction } from "./edgeFunctionClient";
import type { EdgeEnvelope, SuperStudentAction } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";

export type SuperStudentItem = {
  id: string;
  workspace_id: string;
  username: string;
  student_id: string;
  created_at: string;
};

type SuperStudentRequest = {
  action: SuperStudentAction;
  payload: Record<string, unknown>;
};

const callSuperStudent = async <TData>(payload: SuperStudentRequest) => {
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, SuperStudentRequest>(
    "super-student-mutate",
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

export const listSuperStudents = async (workspaceId = "all", search = "") =>
  callSuperStudent<SuperStudentItem[]>({
    action: "list",
    payload: { workspace_id: workspaceId, search },
  });

export const createSuperStudent = async (payload: {
  workspace_id: string;
  username?: string;
  student_id?: string;
}) =>
  callSuperStudent<SuperStudentItem>({
    action: "create",
    payload,
  });

export const deleteSuperStudent = async (payload: {
  id: string;
  super_password: string;
  confirm_phrase: string;
}) =>
  callSuperStudent<{ success: boolean }>({
    action: "delete",
    payload,
  });
