import { supabase } from "./supabaseClient";

export type StudentItem = {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
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

const getFunctionErrorMessage = async (
  error: unknown,
  fallback: string
) => {
  const context = (error as { context?: Response })?.context;
  if (!context) {
    return fallback;
  }
  try {
    const payload = (await context.json()) as
      | { error?: string; message?: string }
      | null;
    return payload?.error || payload?.message || fallback;
  } catch {
    return fallback;
  }
};

export const fetchStudents = async () => {
  const { data, error } = await supabase
    .from("students")
    .select("id, tenant_id, first_name, last_name, student_id")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load students.");
  }

  return (data ?? []) as StudentItem[];
};

export const createStudent = async (payload: {
  tenant_id: string;
  first_name: string;
  last_name: string;
  student_id: string;
}) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session ?? null;
  if (!session?.access_token) {
    throw new Error("Unauthorized.");
  }

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const { data, error } = await supabase.functions.invoke(
    "admin-student-mutate",
    {
      body: {
        action: "create",
        payload: {
          tenant_id: payload.tenant_id,
          first_name: payload.first_name,
          last_name: payload.last_name,
          student_id: payload.student_id,
        },
      },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: anonKey ?? "",
      },
    }
  );

  if (error) {
    throw new Error(
      await getFunctionErrorMessage(error, "Unable to create student.")
    );
  }

  return (data as { data: StudentItem }).data;
};

export const deleteStudent = async (id: string) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session ?? null;
  if (!session?.access_token) {
    throw new Error("Unauthorized.");
  }

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const { error } = await supabase.functions.invoke("admin-student-mutate", {
    body: {
      action: "delete",
      payload: { id },
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: anonKey ?? "",
    },
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error, "Unable to remove student."));
  }
};

export const fetchStudentDetails = async (studentUuid: string) => {
  const { data: checkedOutGear, error: gearError } = await supabase
    .from("gear")
    .select("id, name, barcode")
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
