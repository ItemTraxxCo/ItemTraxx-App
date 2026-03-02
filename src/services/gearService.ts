import { supabase } from "./supabaseClient";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getAuthState } from "../store/authState";

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
  student: { username: string; student_id: string } | null;
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

const getTenantContextId = () => {
  const tenantId = getAuthState().tenantContextId;
  if (!tenantId) {
    throw new Error("Missing tenant context.");
  }
  return tenantId;
};

export const fetchGear = async () => {
  const tenantId = getTenantContextId();
  const { data, error } = await supabase
    .from("gear")
    .select("id, tenant_id, name, barcode, serial_number, status, notes")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load items.");
  }

  return (data ?? []) as GearItem[];
};

export const fetchDeletedGear = async () => {
  const accessToken = await getAccessToken();

  const result = await invokeEdgeFunction<{ data: GearItem[] }>("admin-gear-mutate", {
    method: "POST",
    accessToken,
    body: {
      action: "list_deleted",
      payload: {},
    },
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to load archived items.");
  }

  return (result.data?.data ?? []) as GearItem[];
};

export const createGear = async (payload: {
  tenant_id: string;
  name: string;
  barcode: string;
  serial_number?: string;
  status: string;
  notes?: string;
}) => {
  const accessToken = await getAccessToken();

  const result = await invokeEdgeFunction<{ data: GearItem }>("admin-gear-mutate", {
    method: "POST",
    accessToken,
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
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to create item.");
  }

  return result.data?.data as GearItem;
};

export const updateGear = async (payload: {
  id: string;
  name: string;
  barcode: string;
  status: string;
  notes?: string;
}) => {
  const accessToken = await getAccessToken();

  const result = await invokeEdgeFunction<{ data: GearItem }>("admin-gear-mutate", {
    method: "POST",
    accessToken,
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
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to update item.");
  }

  return result.data?.data as GearItem;
};

export const deleteGear = async (id: string) => {
  const accessToken = await getAccessToken();

  const result = await invokeEdgeFunction("admin-gear-mutate", {
    method: "POST",
    accessToken,
    body: {
      action: "delete",
      payload: { id },
    },
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to remove item.");
  }
};

export const restoreGear = async (id: string) => {
  const accessToken = await getAccessToken();

  const result = await invokeEdgeFunction<{ data: GearItem }>("admin-gear-mutate", {
    method: "POST",
    accessToken,
    body: {
      action: "restore",
      payload: { id },
    },
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to restore item.");
  }

  return result.data?.data as GearItem;
};

export const fetchGearLogs = async () => {
  const tenantId = getTenantContextId();
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
        student:checked_out_by ( username, student_id )
      `
    )
    .eq("tenant_id", tenantId)
    .order("action_time", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error("Unable to load item logs.");
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
      username: string;
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
