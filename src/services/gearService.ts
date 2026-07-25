import { invokeEdgeFunction } from "./edgeFunctionClient";
import { authenticatedSelect } from "./authenticatedDataClient";
import { getAuthState } from "../store/authState";
import { edgeFunctionError, missingContextError } from "./appErrors";
import { getOrCreateDeviceSession } from "../utils/deviceSession";

export type GearItem = {
  id: string;
  workspace_id: string;
  name: string;
  barcode: string;
  serial_number: string | null;
  status: string;
  notes: string | null;
  access_mode?: "all" | "restricted";
};

export type GearLog = {
  id: string;
  workspace_id: string;
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

const getWorkspaceContextId = () => {
  const workspaceId = getAuthState().workspaceContextId;
  if (!workspaceId) {
    throw missingContextError("Missing workspace context. Please try again or contact support.");
  }
  return workspaceId;
};

export const fetchGear = async () => {
  const workspaceId = getWorkspaceContextId();
  return (await authenticatedSelect<GearItem[]>("gear", {
    select: "id,workspace_id,name,barcode,serial_number,status,notes",
    workspace_id: `eq.${workspaceId}`,
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
    throw edgeFunctionError(result, "Unable to load archived items. Please contact support.");
  }

  return (result.data?.data ?? []) as GearItem[];
};

export const createGear = async (payload: {
  workspace_id: string;
  name: string;
  barcode: string;
  serial_number?: string;
  status: string;
  notes?: string;
  access_mode: "all" | "restricted";
  profile_ids: string[];
}) => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<{ data: GearItem }>("admin-gear-mutate", {
    method: "POST",
    body: {
      action: "create",
      payload: {
        device_id: deviceId,
        workspace_id: payload.workspace_id,
        name: payload.name,
        barcode: payload.barcode,
        serial_number: payload.serial_number ?? null,
        status: payload.status,
        notes: payload.notes ?? null,
        access_mode: payload.access_mode,
        profile_ids: payload.profile_ids,
      },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to create item. Please make sure your information is accurate and try again.");
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
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<{ data: GearItem }>("admin-gear-mutate", {
    method: "POST",
    body: {
      action: "update",
      payload: {
        device_id: deviceId,
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
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction("admin-gear-mutate", {
    method: "POST",
    body: {
      action: "delete",
      payload: { id, device_id: deviceId },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to remove item.");
  }
};

export const restoreGear = async (id: string) => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<{ data: GearItem }>("admin-gear-mutate", {
    method: "POST",
    body: {
      action: "restore",
      payload: { id, device_id: deviceId },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to restore item.");
  }

  return result.data?.data as GearItem;
};

export const fetchGearLogs = async () => {
  const workspaceId = getWorkspaceContextId();
  const rows = ((await authenticatedSelect<Array<{
    id: string;
    workspace_id: string;
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
      "id,workspace_id,gear_id,checked_out_by,action_type,action_time,performed_by,gear:gear_id(name,barcode),student:checked_out_by(username,student_id)",
    workspace_id: `eq.${workspaceId}`,
    order: "action_time.desc",
    limit: "200",
  })) ?? []) as Array<{
    id: string;
    workspace_id: string;
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
    workspace_id: row.workspace_id,
    gear_id: row.gear_id,
    checked_out_by: row.checked_out_by,
    action_type: row.action_type,
    action_time: row.action_time,
    performed_by: row.performed_by,
    gear: pickRelation(row.gear),
    student: pickRelation(row.student),
  }));
};
