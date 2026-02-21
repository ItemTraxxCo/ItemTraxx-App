import { supabase } from "./supabaseClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { withTimeout } from "./asyncUtils";

type CheckoutReturnPayload = {
  student_id: string;
  gear_barcodes: string[];
  action_type: "checkout" | "return" | "auto" | "admin_return";
};

const LOOKUP_TIMEOUT_MS = 7000;

export const submitCheckoutReturn = async (
  payload: CheckoutReturnPayload
) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session ?? null;

  if (!session?.access_token) {
    throw new Error("Unauthorized.");
  }

  const result = await invokeEdgeFunction("checkoutReturn", {
    method: "POST",
    body: payload,
    accessToken: session.access_token,
  });

  if (!result.ok) {
    if (result.status === 429) {
      throw new Error("Rate limit exceeded, please try again in a minute.");
    }
    throw new Error(result.error || "Request failed.");
  }

  return result.data;
};

export type StudentSummary = {
  id: string;
  username: string;
  student_id: string;
};

export type GearSummary = {
  id: string;
  name: string;
  barcode: string;
  status: string;
};

export const fetchGearByBarcode = async (barcode: string) => {
  const { data, error } = await withTimeout(
    supabase
      .from("gear")
      .select("id, name, barcode, status")
      .eq("barcode", barcode)
      .is("deleted_at", null)
      .single(),
    LOOKUP_TIMEOUT_MS,
    "Barcode lookup timed out."
  );

  if (error) {
    throw new Error("Invalid barcode.");
  }

  return data as GearSummary;
};

export const fetchStudentByStudentId = async (studentId: string) => {
  const { data, error } = await withTimeout(
    supabase
      .from("students")
      .select("id, username, student_id")
      .eq("student_id", studentId)
      .is("deleted_at", null)
      .single(),
    LOOKUP_TIMEOUT_MS,
    "Student lookup timed out."
  );

  if (error) {
    throw new Error("Student not found.");
  }

  return data as StudentSummary;
};

export const fetchCheckedOutGear = async (studentUuid: string) => {
  const { data, error } = await withTimeout(
    supabase
      .from("gear")
      .select("id, name, barcode, status")
      .eq("checked_out_by", studentUuid)
      .is("deleted_at", null),
    LOOKUP_TIMEOUT_MS,
    "Checked out items lookup timed out."
  );

  if (error) {
    throw new Error("Unable to load items.");
  }

  return (data ?? []) as GearSummary[];
};
