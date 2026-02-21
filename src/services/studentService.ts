import { supabase } from "./supabaseClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";

export type StudentItem = {
  id: string;
  tenant_id: string;
  username: string;
  student_id: string;
};

export type StudentDetails = {
  checkedOutGear: { id: string; name: string; barcode: string }[];
  lastCheckout: { action_time: string; gear_name: string | null } | null;
  lastReturn: { action_time: string; gear_name: string | null } | null;
};

type MaybeRelation<T> = T | T[] | null;

const pickRelation = <T>(value: MaybeRelation<T>): T | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
};

const getAccessToken = async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session ?? null;
  if (!session?.access_token) {
    throw new Error("Unauthorized.");
  }
  return session.access_token;
};

export const fetchStudents = async () => {
  const { data, error } = await supabase
    .from("students")
    .select("id, tenant_id, username, student_id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load students.");
  }

  return (data ?? []) as StudentItem[];
};

export const fetchDeletedStudents = async () => {
  const accessToken = await getAccessToken();

  const result = await invokeEdgeFunction<{ data: StudentItem[] }>(
    "admin-student-mutate",
    {
      method: "POST",
      accessToken,
      body: {
        action: "list_deleted",
        payload: {},
      },
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Unable to load archived students.");
  }

  return (result.data?.data ?? []) as StudentItem[];
};

export const createStudent = async (payload: {
  tenant_id: string;
  username?: string;
  student_id?: string;
}) => {
  const accessToken = await getAccessToken();

  const result = await invokeEdgeFunction<{ data: StudentItem }>(
    "admin-student-mutate",
    {
      method: "POST",
      accessToken,
      body: {
        action: "create",
        payload: {
          tenant_id: payload.tenant_id,
          username: payload.username ?? "",
          student_id: payload.student_id ?? "",
        },
      },
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Unable to create student.");
  }

  return result.data?.data as StudentItem;
};

export const bulkCreateStudents = async (
  rows: Array<{ username?: string; student_id?: string }>
) => {
  const accessToken = await getAccessToken();

  const result = await invokeEdgeFunction<{
    data: {
      inserted_count: number;
      skipped_count: number;
      inserted: StudentItem[];
      skipped: Array<{ row: number; reason: string }>;
    };
  }>("admin-student-mutate", {
    method: "POST",
    accessToken,
    body: {
      action: "bulk_create",
      payload: { rows },
    },
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to import students.");
  }

  return result.data?.data as {
    inserted_count: number;
    skipped_count: number;
    inserted: StudentItem[];
    skipped: Array<{ row: number; reason: string }>;
  };
};

export const deleteStudent = async (id: string) => {
  const accessToken = await getAccessToken();

  const result = await invokeEdgeFunction("admin-student-mutate", {
    method: "POST",
    accessToken,
    body: {
      action: "delete",
      payload: { id },
    },
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to remove student.");
  }
};

export const restoreStudent = async (id: string) => {
  const accessToken = await getAccessToken();

  const result = await invokeEdgeFunction<{ data: StudentItem }>(
    "admin-student-mutate",
    {
      method: "POST",
      accessToken,
      body: {
        action: "restore",
        payload: { id },
      },
    }
  );

  if (!result.ok) {
    throw new Error(result.error || "Unable to restore student.");
  }

  return result.data?.data as StudentItem;
};

export const fetchStudentDetails = async (studentUuid: string) => {
  const { data: checkedOutGear, error: gearError } = await supabase
    .from("gear")
    .select("id, name, barcode")
    .is("deleted_at", null)
    .eq("checked_out_by", studentUuid);

  if (gearError) {
    throw new Error("Unable to load student details.");
  }

  const { data: lastCheckoutData, error: checkoutError } = await supabase
    .from("gear_logs")
    .select("action_time, gear:gear_id ( name )")
    .eq("checked_out_by", studentUuid)
    .eq("action_type", "checkout")
    .order("action_time", { ascending: false })
    .limit(1);

  if (checkoutError) {
    throw new Error("Unable to load student details.");
  }

  const { data: lastReturnData, error: returnError } = await supabase
    .from("gear_logs")
    .select("action_time, gear:gear_id ( name )")
    .eq("checked_out_by", studentUuid)
    .eq("action_type", "return")
    .order("action_time", { ascending: false })
    .limit(1);

  if (returnError) {
    throw new Error("Unable to load student details.");
  }

  const checkoutRow = (lastCheckoutData?.[0] ?? null) as
    | { action_time: string; gear: MaybeRelation<{ name: string }> }
    | null;
  const lastCheckout = checkoutRow
    ? {
        action_time: checkoutRow.action_time,
        gear_name: pickRelation(checkoutRow.gear)?.name ?? null,
      }
    : null;

  const returnRow = (lastReturnData?.[0] ?? null) as
    | { action_time: string; gear: MaybeRelation<{ name: string }> }
    | null;
  const lastReturn = returnRow
    ? {
        action_time: returnRow.action_time,
        gear_name: pickRelation(returnRow.gear)?.name ?? null,
      }
    : null;

  return {
    checkedOutGear: (checkedOutGear ?? []) as {
      id: string;
      name: string;
      barcode: string;
    }[],
    lastCheckout,
    lastReturn,
  } as StudentDetails;
};
