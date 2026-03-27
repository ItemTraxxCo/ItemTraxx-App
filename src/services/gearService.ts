import { invokeEdgeFunction } from "./edgeFunctionClient";
import { authenticatedSelect } from "./authenticatedDataClient";
import { getAuthState } from "../store/authState";
import { edgeFunctionError, missingContextError } from "./appErrors";

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

const getTenantContextId = () => {
  const tenantId = getAuthState().tenantContextId;
  if (!tenantId) {
    throw missingContextError("Missing tenant context.");
  }
  return tenantId;
};

export const fetchGear = async () => {
  const tenantId = getTenantContextId();
  return (await authenticatedSelect<GearItem[]>("gear", {
    select: "id,tenant_id,name,barcode,serial_number,status,notes",
    tenant_id: `eq.${tenantId}`,
    deleted_at: "is.null",
    order: "created_at.desc",
  })) ?? [];
};

export const fetchDeletedGear = async () => {
  const result = await invokeEdgeFunction<{ data: GearItem[] }>("admin-gear-mutate", {
    method: "POST",
    body: {
      action: "list_deleted",
      payload: {},
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to load archived items.");
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
  const result = await invokeEdgeFunction<{ data: GearItem }>("admin-gear-mutate", {
    method: "POST",
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
    throw edgeFunctionError(result, "Unable to create item.");
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
  const result = await invokeEdgeFunction<{ data: GearItem }>("admin-gear-mutate", {
    method: "POST",
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
    throw edgeFunctionError(result, "Unable to update item.");
  }

  return result.data?.data as GearItem;
};

export const deleteGear = async (id: string) => {
  const result = await invokeEdgeFunction("admin-gear-mutate", {
    method: "POST",
    body: {
      action: "delete",
      payload: { id },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to remove item.");
  }
};

export const restoreGear = async (id: string) => {
  const result = await invokeEdgeFunction<{ data: GearItem }>("admin-gear-mutate", {
    method: "POST",
    body: {
      action: "restore",
      payload: { id },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to restore item.");
  }

  return result.data?.data as GearItem;
};

export const fetchGearLogs = async () => {
  const tenantId = getTenantContextId();
  const rows = ((await authenticatedSelect<Array<{
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
  }>>("gear_logs", {
    select:
      "id,tenant_id,gear_id,checked_out_by,action_type,action_time,performed_by,gear:gear_id(name,barcode),student:checked_out_by(username,student_id)",
    tenant_id: `eq.${tenantId}`,
    order: "action_time.desc",
    limit: "200",
  })) ?? []) as Array<{
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
