import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getFreshAccessToken } from "./sessionAccessToken";
import type { EdgeEnvelope, SuperStudentAction } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";

export type SuperStudentItem = {
  id: string;
  tenant_id: string;
  username: string;
  student_id: string;
  created_at: string;
};

type SuperStudentRequest = {
  action: SuperStudentAction;
  payload: Record<string, unknown>;
};

const getAccessToken = getFreshAccessToken;

const callSuperStudent = async <TData>(payload: SuperStudentRequest) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<EdgeEnvelope<TData>, SuperStudentRequest>(
    "super-student-mutate",
    {
      method: "POST",
      accessToken,
      body: payload,
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Super student request failed.");
  }

  return result.data?.data as TData;
};

export const listSuperStudents = async (tenantId = "all", search = "") =>
  callSuperStudent<SuperStudentItem[]>({
    action: "list",
    payload: { tenant_id: tenantId, search },
  });

export const createSuperStudent = async (payload: {
  tenant_id: string;
  username?: string;
  student_id?: string;
}) =>
  callSuperStudent<SuperStudentItem>({
    action: "create",
    payload,
  });

export const updateSuperStudent = async (payload: { id: string }) =>
  callSuperStudent<SuperStudentItem>({
    action: "update",
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
