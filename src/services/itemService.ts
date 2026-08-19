import { invokeEdgeFunction } from "./edgeFunctionClient";
import { authenticatedSelect } from "./authenticatedDataClient";
import { getAuthState } from "../store/authState";
import { edgeFunctionError, missingContextError } from "./appErrors";
import { getOrCreateDeviceSession } from "../utils/deviceSession";

export type ItemRecord = {
  id: string;
  workspace_id: string;
  name: string;
  barcode: string;
  serial_number: string | null;
  status: string;
  notes: string | null;
  access_mode?: "all" | "restricted";
};

export type ItemLog = {
  id: string;
  workspace_id: string;
  item_id: string;
  checked_out_by: string | null;
  action_type: string;
  action_time: string;
  performed_by: string | null;
  tenant_account: { auth_email: string | null } | null;
  item: { name: string; barcode: string } | null;
  borrower: { username: string; borrower_id: string } | null;
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

export const fetchItem = async () => {
  const workspaceId = getWorkspaceContextId();
  return (await authenticatedSelect<ItemRecord[]>("items", {
    select: "id,workspace_id,name,barcode,serial_number,status,notes,access_mode",
    workspace_id: `eq.${workspaceId}`,
    deleted_at: "is.null",
    order: "created_at.desc",
  })) ?? [];
};

export const fetchDeletedItem = async () => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<{ data: ItemRecord[] }>("admin-item-mutate", {
    method: "POST",
    body: {
      action: "list_deleted",
      payload: { device_id: deviceId },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to load archived items. Please contact support.");
  }

  return (result.data?.data ?? []) as ItemRecord[];
};

export const createItem = async (payload: {
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
  const result = await invokeEdgeFunction<{ data: ItemRecord }>("admin-item-mutate", {
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

  return result.data?.data as ItemRecord;
};

export const updateItem = async (payload: {
  id: string;
  name: string;
  barcode: string;
  status: string;
  notes?: string;
  access_mode: "all" | "restricted";
  profile_ids: string[];
}) => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<{ data: ItemRecord }>("admin-item-mutate", {
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
        access_mode: payload.access_mode,
        profile_ids: payload.profile_ids,
      },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to update item.");
  }

  return result.data?.data as ItemRecord;
};

export const deleteItem = async (id: string) => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction("admin-item-mutate", {
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

export const restoreItem = async (id: string) => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<{ data: ItemRecord }>("admin-item-mutate", {
    method: "POST",
    body: {
      action: "restore",
      payload: { id, device_id: deviceId },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to restore item.");
  }

  return result.data?.data as ItemRecord;
};

export const fetchItemLogs = async () => {
  const workspaceId = getWorkspaceContextId();
  const rows = ((await authenticatedSelect<Array<{
    id: string;
    workspace_id: string;
    item_id: string;
    checked_out_by: string | null;
    action_type: string;
    action_time: string;
    performed_by: string | null;
    item: MaybeRelation<{ name: string; barcode: string }>;
    borrower: MaybeRelation<{
      username: string;
      borrower_id: string;
    }>;
  }>>("item_logs", {
    select:
      "id,workspace_id,item_id,checked_out_by,action_type,action_time,performed_by,item:item_id(name,barcode),borrower:checked_out_by(username,borrower_id)",
    workspace_id: `eq.${workspaceId}`,
    order: "action_time.desc",
    limit: "200",
  })) ?? []) as Array<{
    id: string;
    workspace_id: string;
    item_id: string;
    checked_out_by: string | null;
    action_type: string;
    action_time: string;
    performed_by: string | null;
    item: MaybeRelation<{ name: string; barcode: string }>;
    borrower: MaybeRelation<{
      username: string;
      borrower_id: string;
    }>;
  }>;

  const performerIds = [...new Set(rows.flatMap((row) => row.performed_by ? [row.performed_by] : []))];
  const performers = performerIds.length > 0
    ? (await authenticatedSelect<Array<{ id: string; auth_email: string | null }>>("profiles", {
      select: "id,auth_email",
      workspace_id: `eq.${workspaceId}`,
      id: `in.(${performerIds.join(",")})`,
    })) ?? []
    : [];
  const performersById = new Map(performers.map((performer) => [performer.id, performer]));

  return rows.map((row) => ({
    id: row.id,
    workspace_id: row.workspace_id,
    item_id: row.item_id,
    checked_out_by: row.checked_out_by,
    action_type: row.action_type,
    action_time: row.action_time,
    performed_by: row.performed_by,
    tenant_account: row.performed_by ? performersById.get(row.performed_by) ?? null : null,
    item: pickRelation(row.item),
    borrower: pickRelation(row.borrower),
  }));
};
