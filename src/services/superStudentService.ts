import { invokeEdgeFunction } from "./edgeFunctionClient";
import { supabase } from "./supabaseClient";

export type SuperStudentItem = {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  student_id: string;
  email?: string | null;
  created_at: string;
};

type SuperStudentAction = "list" | "create" | "update" | "delete";

type SuperStudentRequest = {
  action: SuperStudentAction;
  payload: Record<string, unknown>;
};

const getAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Unauthorized");
  return data.session.access_token;
};

const callSuperStudent = async <TData>(payload: SuperStudentRequest) => {
  const accessToken = await getAccessToken();
  const result = await invokeEdgeFunction<{ data?: TData }, SuperStudentRequest>(
    "super-student-mutate",
    {
      method: "POST",
      accessToken,
      body: payload,
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Super student request failed.");
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
  first_name: string;
  last_name: string;
  student_id: string;
  email?: string;
}) =>
  callSuperStudent<SuperStudentItem>({
    action: "create",
    payload,
  });

export const updateSuperStudent = async (payload: {
  id: string;
  first_name: string;
  last_name: string;
  student_id: string;
}) =>
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
