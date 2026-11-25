import { invokeEdgeFunction } from "./edgeFunctionClient";
import { authenticatedSelect, authenticatedSelectPage } from "./authenticatedDataClient";
import { getAuthState } from "../store/authState";
import { edgeFunctionError, missingContextError } from "./appErrors";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import { isEncryptedBorrowerDirectoryEnabled } from "./borrowerEncryptionMode";
export { isEncryptedBorrowerDirectoryEnabled } from "./borrowerEncryptionMode";

export type BorrowerItem = {
  id: string;
  workspace_id: string;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string;
  email?: string | null;
  borrower_id: string;
  access_mode?: "all" | "restricted";
};

export type BorrowerDetails = {
  checkedOutItem: { id: string; name: string; barcode: string }[];
  lastCheckout: { action_time: string; item_name: string | null } | null;
  lastReturn: { action_time: string; item_name: string | null } | null;
};

type MaybeRelation<T> = T | T[] | null;
const ADMIN_LIST_PAGE_SIZE = 500;
const ACCESS_GRANT_BATCH_SIZE = 100;

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
  // Admin search/export currently needs the complete active set. Keep that
  // compatibility contract while bounding every individual PostgREST request;
  // interactive pages should use fetchBorrowerPage instead.
  const rows: BorrowerItem[] = [];
  const encryptedMode = await isEncryptedBorrowerDirectoryEnabled();
  let page = 0;
  while (true) {
    const result = await fetchBorrowerPage(page, encryptedMode ? 50 : ADMIN_LIST_PAGE_SIZE, "created_at.desc", encryptedMode);
    if (encryptedMode && rows.length + result.rows.length > 10000) throw new Error("Encrypted borrower directory exceeds the supported limit.");
    rows.push(...result.rows);
    if (!result.hasMore) return rows;
    page += 1;
  }
};

export const fetchSortedBorrowers = async () =>
  (await fetchBorrowers()).sort((left, right) =>
    left.username.localeCompare(right.username, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id)
  );

export const fetchBorrowerPage = async (
  page = 0,
  pageSize = 20,
  order = "created_at.desc",
  resolvedMode?: boolean,
) => {
  const workspaceId = getWorkspaceContextId();
  if (resolvedMode ?? await isEncryptedBorrowerDirectoryEnabled()) {
    if (pageSize > 50) throw new Error("Encrypted borrower pages are limited to 50 records.");
    const { deviceId } = getOrCreateDeviceSession();
    const response = await invokeEdgeFunction<{ data: { rows: BorrowerItem[]; hasMore: boolean } }>("crypto-broker", {
      method: "POST", body: { action: "list", page, page_size: pageSize, device_id: deviceId },
    });
    if (!response.ok || !response.data?.data) throw edgeFunctionError(response, "Unable to load encrypted borrowers.");
    return response.data.data;
  }
  return authenticatedSelectPage<BorrowerItem>("borrowers", {
    select: "id,workspace_id,username,borrower_id,access_mode",
    workspace_id: `eq.${workspaceId}`,
    deleted_at: "is.null",
    order,
  }, { page, pageSize });
};

export type BorrowerAccessGrant = { borrower_id: string; profile_id: string };

export const fetchBorrowerAccessGrants = async (borrowerIds: string[]) => {
  if (borrowerIds.length === 0) return [] as BorrowerAccessGrant[];
  const grants: BorrowerAccessGrant[] = [];
  for (let index = 0; index < borrowerIds.length; index += ACCESS_GRANT_BATCH_SIZE) {
    const batch = borrowerIds.slice(index, index + ACCESS_GRANT_BATCH_SIZE);
    grants.push(...((await authenticatedSelect<BorrowerAccessGrant[]>("borrower_access_grants", {
      select: "borrower_id,profile_id",
      borrower_id: `in.(${batch.join(",")})`,
    })) ?? []));
  }
  return grants;
};

export const fetchDeletedBorrowers = async () => {
  const { deviceId } = getOrCreateDeviceSession();
  if (await isEncryptedBorrowerDirectoryEnabled()) {
    const rows: BorrowerItem[] = [];
    for (let page = 0; ; page++) {
      const response = await invokeEdgeFunction<{ data: { rows: BorrowerItem[]; hasMore: boolean } }>("crypto-broker", {
        method: "POST", body: { action: "list", archived: true, page, page_size: 50, device_id: deviceId },
      });
      if (!response.ok || !response.data?.data) throw edgeFunctionError(response, "Unable to load archived borrowers.");
      if (rows.length + response.data.data.rows.length > 10000) throw new Error("Encrypted borrower directory exceeds the local preview limit.");
      rows.push(...response.data.data.rows);
      if (!response.data.data.hasMore) return rows;
    }
  }
  const result = await invokeEdgeFunction<{ data: BorrowerItem[] }>(
    "admin-borrower-mutate",
    {
      method: "POST",
      body: {
        action: "list_deleted",
        payload: { device_id: deviceId },
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
  first_name?: string;
  last_name?: string | null;
  email?: string | null;
  borrower_id?: string;
  access_mode: "all" | "restricted";
  profile_ids: string[];
}) => {
  const { deviceId } = getOrCreateDeviceSession();
  if (payload.first_name !== undefined) {
    const result = await invokeEdgeFunction<{ data: BorrowerItem }>("crypto-broker", {
      method: "POST", body: { action: "create", device_id: deviceId, payload: {
        first_name: payload.first_name, last_name: payload.last_name ?? null,
        borrower_id: payload.borrower_id ?? "", email: payload.email ?? null,
        access_mode: payload.access_mode, profile_ids: payload.profile_ids,
      } },
    });
    if (!result.ok || !result.data?.data) throw edgeFunctionError(result, "Unable to create borrower.");
    return result.data.data;
  }
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
  if (await isEncryptedBorrowerDirectoryEnabled()) {
    const response = await invokeEdgeFunction<{ data: BorrowerItem }>("crypto-broker", {
      method: "POST", body: { action: "restore", id, device_id: deviceId },
    });
    if (!response.ok || !response.data?.data) throw edgeFunctionError(response, "Unable to restore borrower.");
    return response.data.data;
  }
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
