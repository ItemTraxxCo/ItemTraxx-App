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
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session ?? null;
  if (!session?.access_token) {
    throw new Error("Unauthorized.");
  }

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const { data, error } = await supabase.functions.invoke("admin-gear-mutate", {
    body: {
      action: "create",
      payload: {
        tenant_id: payload.tenant_id,
        name: payload.name,
        barcode: payload.barcode,
        serial_number: payload.serial_number ?? null,
        status: payload.status,
        notes: payload.notes ?? null,
      },
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: anonKey ?? "",
    },
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error, "Unable to create gear."));
  }

  return (data as { data: GearItem }).data;
};

export const updateGear = async (payload: {
  id: string;
  name: string;
  barcode: string;
  status: string;
  notes?: string;
}) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session ?? null;
  if (!session?.access_token) {
    throw new Error("Unauthorized.");
  }

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const { data, error } = await supabase.functions.invoke("admin-gear-mutate", {
    body: {
      action: "update",
      payload: {
        id: payload.id,
        name: payload.name,
        barcode: payload.barcode,
        status: payload.status,
        notes: payload.notes ?? null,
      },
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: anonKey ?? "",
    },
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error, "Unable to update gear."));
  }

  return (data as { data: GearItem }).data;
};

export const deleteGear = async (id: string) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session ?? null;
  if (!session?.access_token) {
    throw new Error("Unauthorized.");
  }

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const { error } = await supabase.functions.invoke("admin-gear-mutate", {
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
    throw new Error(await getFunctionErrorMessage(error, "Unable to remove gear."));
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

  const rows = (data ?? []) as Array<{
    id: string;
    tenant_id: string;
    gear_id: string;
    checked_out_by: string | null;
    action_type: string;
    action_time: string;
    performed_by: string | null;
    gear: MaybeRelation<{ name: string; barcode: string }>;
    student: MaybeRelation<{
      first_name: string;
      last_name: string;
      student_id: string;
    }>;
  }>;

  return rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    gear_id: row.gear_id,
    checked_out_by: row.checked_out_by,
    action_type: row.action_type,
    action_time: row.action_time,
    performed_by: row.performed_by,
    gear: pickRelation(row.gear),
    student: pickRelation(row.student),
  }));
};
