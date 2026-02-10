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
  const { data, error } = await supabase
    .from("students")
    .insert({
      tenant_id: payload.tenant_id,
      first_name: payload.first_name,
      last_name: payload.last_name,
      student_id: payload.student_id,
    })
    .select("id, tenant_id, first_name, last_name, student_id")
    .single();

  if (error) {
    throw new Error("Unable to create student.");
  }

  return data as StudentItem;
};

export const deleteStudent = async (id: string) => {
  const { error } = await supabase.from("students").delete().eq("id", id);
  if (error) {
    throw new Error("Unable to remove student.");
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

  const lastCheckout = lastCheckoutData?.[0]
    ? {
        action_time: lastCheckoutData[0].action_time,
        gear_name: lastCheckoutData[0].gear?.name ?? null,
      }
    : null;

  const lastReturn = lastReturnData?.[0]
    ? {
        action_time: lastReturnData[0].action_time,
        gear_name: lastReturnData[0].gear?.name ?? null,
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
