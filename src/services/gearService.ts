import { supabase } from "./supabaseClient";

export type GearItem = {
  id: string;
  tenant_id: string;
  name: string;
  barcode: string;
  serial_number: string | null;
  status: string;
  notes: string | null;
};

export type GearLog = {
  id: string;
  tenant_id: string;
  gear_id: string;
  checked_out_by: string | null;
  action_type: string;
  action_time: string;
  performed_by: string | null;
  gear: { name: string; barcode: string } | null;
  student: { first_name: string; last_name: string; student_id: string } | null;
};

export const fetchGear = async () => {
  const { data, error } = await supabase
    .from("gear")
    .select("id, tenant_id, name, barcode, serial_number, status, notes")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load gear.");
  }

  return (data ?? []) as GearItem[];
};

export const createGear = async (payload: {
  tenant_id: string;
  name: string;
  barcode: string;
  serial_number?: string;
  status: string;
  notes?: string;
}) => {
  const { data, error } = await supabase
    .from("gear")
    .insert({
      tenant_id: payload.tenant_id,
      name: payload.name,
      barcode: payload.barcode,
      serial_number: payload.serial_number ?? null,
      status: payload.status,
      notes: payload.notes ?? null,
    })
    .select("id, tenant_id, name, barcode, serial_number, status, notes")
    .single();

  if (error) {
    throw new Error("Unable to create gear.");
  }

  return data as GearItem;
};

export const updateGear = async (payload: {
  id: string;
  name: string;
  barcode: string;
  status: string;
  notes?: string;
}) => {
  const { data, error } = await supabase
    .from("gear")
    .update({
      name: payload.name,
      barcode: payload.barcode,
      status: payload.status,
      notes: payload.notes ?? null,
    })
    .eq("id", payload.id)
    .select("id, tenant_id, name, barcode, serial_number, status, notes")
    .single();

  if (error) {
    throw new Error("Unable to update gear.");
  }

  return data as GearItem;
};

export const deleteGear = async (id: string) => {
  const { error } = await supabase.from("gear").delete().eq("id", id);
  if (error) {
    throw new Error("Unable to remove gear.");
  }
};

export const fetchGearLogs = async () => {
  const { data, error } = await supabase
    .from("gear_logs")
    .select(
      `
        id,
        tenant_id,
        gear_id,
        checked_out_by,
        action_type,
        action_time,
        performed_by,
        gear:gear_id ( name, barcode ),
        student:checked_out_by ( first_name, last_name, student_id )
      `
    )
    .order("action_time", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error("Unable to load gear logs.");
  }

  return (data ?? []) as GearLog[];
};
