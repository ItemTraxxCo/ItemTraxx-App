import { invokeEdgeFunction } from "./edgeFunctionClient";
import { authenticatedSelect } from "./authenticatedDataClient";
import { getAuthState } from "../store/authState";
import { edgeFunctionError, missingContextError } from "./appErrors";
import { getOrCreateDeviceSession } from "../utils/deviceSession";

export type BorrowerItem = {
  id: string;
  workspace_id: string;
  username: string;
  borrower_id: string;
  access_mode?: "all" | "restricted";
};

export type BorrowerDetails = {
  checkedOutItem: { id: string; name: string; barcode: string }[];
  lastCheckout: { action_time: string; item_name: string | null } | null;
  lastReturn: { action_time: string; item_name: string | null } | null;
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

export const fetchBorrowers = async () => {
  const workspaceId = getWorkspaceContextId();
  return (await authenticatedSelect<BorrowerItem[]>("borrowers", {
    select: "id,workspace_id,username,borrower_id,access_mode",
    workspace_id: `eq.${workspaceId}`,
    deleted_at: "is.null",
    order: "created_at.desc",
  })) ?? [];
};

export const fetchDeletedBorrowers = async () => {
  const result = await invokeEdgeFunction<{ data: BorrowerItem[] }>(
    "admin-borrower-mutate",
    {
      method: "POST",
      body: {
        action: "list_deleted",
        payload: {},
      },
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to load archived borrowers. Please try again.");
  }

  return (result.data?.data ?? []) as BorrowerItem[];
};

export const createBorrower = async (payload: {
  workspace_id: string;
  username?: string;
  borrower_id?: string;
  access_mode: "all" | "restricted";
  profile_ids: string[];
}) => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<{ data: BorrowerItem }>(
    "admin-borrower-mutate",
    {
      method: "POST",
      body: {
        action: "create",
        payload: {
          device_id: deviceId,
          workspace_id: payload.workspace_id,
          username: payload.username ?? "",
          borrower_id: payload.borrower_id ?? "",
          access_mode: payload.access_mode,
          profile_ids: payload.profile_ids,
        },
      },
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to create borrower. Please try again or contact suppport.");
  }

  return result.data?.data as BorrowerItem;
};

export const updateBorrowerAccess = async (payload: {
  id: string;
  access_mode: "all" | "restricted";
  profile_ids: string[];
}) => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<{ success: boolean }>(
    "admin-borrower-mutate",
    {
      method: "POST",
      body: {
        action: "update_access",
        payload: {
          device_id: deviceId,
          id: payload.id,
          access_mode: payload.access_mode,
          profile_ids: payload.profile_ids,
        },
      },
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to update tenant account access.");
  }
};

export const bulkCreateBorrowers = async (
  rows: Array<{ username?: string; borrower_id?: string }>
) => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<{
    data: {
      inserted_count: number;
      skipped_count: number;
      inserted: BorrowerItem[];
      skipped: Array<{ row: number; reason: string }>;
    };
  }>("admin-borrower-mutate", {
    method: "POST",
    body: {
      action: "bulk_create",
      payload: { rows, device_id: deviceId },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to import borrowers. Please try again or contact support..");
  }

  return result.data?.data as {
    inserted_count: number;
    skipped_count: number;
    inserted: BorrowerItem[];
    skipped: Array<{ row: number; reason: string }>;
  };
};

export const deleteBorrower = async (id: string) => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction("admin-borrower-mutate", {
    method: "POST",
    body: {
      action: "delete",
      payload: { id, device_id: deviceId },
    },
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to remove borrower. Please try again or contact support.");
  }
};

export const restoreBorrower = async (id: string) => {
  const { deviceId } = getOrCreateDeviceSession();
  const result = await invokeEdgeFunction<{ data: BorrowerItem }>(
    "admin-borrower-mutate",
    {
      method: "POST",
      body: {
        action: "restore",
        payload: { id, device_id: deviceId },
      },
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to restore borrower. Please try again or contact support.");
  }

  return result.data?.data as BorrowerItem;
};

export const fetchBorrowerDetails = async (borrowerUuid: string) => {
  const workspaceId = getWorkspaceContextId();
  const checkedOutItem = await authenticatedSelect<Array<{ id: string; name: string; barcode: string }>>("items", {
    select: "id,name,barcode",
    workspace_id: `eq.${workspaceId}`,
    deleted_at: "is.null",
    checked_out_by: `eq.${borrowerUuid}`,
  });

  const lastCheckoutData = await authenticatedSelect<Array<{ action_time: string; item: { name: string }[] | { name: string } | null }>>("item_logs", {
    select: "action_time,item:item_id(name)",
    workspace_id: `eq.${workspaceId}`,
    checked_out_by: `eq.${borrowerUuid}`,
    action_type: "eq.checkout",
    order: "action_time.desc",
    limit: "1",
  });

  const lastReturnData = await authenticatedSelect<Array<{ action_time: string; item: { name: string }[] | { name: string } | null }>>("item_logs", {
    select: "action_time,item:item_id(name)",
    workspace_id: `eq.${workspaceId}`,
    checked_out_by: `eq.${borrowerUuid}`,
    action_type: "eq.return",
    order: "action_time.desc",
    limit: "1",
  });

  const checkoutRow = (lastCheckoutData?.[0] ?? null) as
    | { action_time: string; item: MaybeRelation<{ name: string }> }
    | null;
  const lastCheckout = checkoutRow
    ? {
        action_time: checkoutRow.action_time,
        item_name: pickRelation(checkoutRow.item)?.name ?? null,
      }
    : null;

  const returnRow = (lastReturnData?.[0] ?? null) as
    | { action_time: string; item: MaybeRelation<{ name: string }> }
    | null;
  const lastReturn = returnRow
    ? {
        action_time: returnRow.action_time,
        item_name: pickRelation(returnRow.item)?.name ?? null,
      }
    : null;

  return {
    checkedOutItem: (checkedOutItem ?? []) as {
      id: string;
      name: string;
      barcode: string;
    }[],
    lastCheckout,
    lastReturn,
  } as BorrowerDetails;
};
