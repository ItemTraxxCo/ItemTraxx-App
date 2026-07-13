import { callSuperOps } from "./client";
import type {
  SupportRequestDetail,
  SupportRequestListItem,
  SupportRequestStatus,
} from "./types";

export type {
  SupportRequestDetail,
  SupportRequestListItem,
  SupportRequestStatus,
} from "./types";

export const listSupportRequests = async (payload: {
  search?: string;
  status?: SupportRequestStatus | "";
  limit?: number;
} = {}) =>
  callSuperOps<{ requests: SupportRequestListItem[] }>({
    action: "list_support_requests",
    payload,
  });

export const getSupportRequest = async (payload: { support_request_id: string }) =>
  callSuperOps<{ request: SupportRequestDetail }>({
    action: "get_support_request",
    payload,
  });

export const updateSupportRequest = async (payload: {
  support_request_id: string;
  status?: SupportRequestStatus;
  internal_notes?: string;
  assign_to_me?: boolean;
  clear_assignment?: boolean;
}) =>
  callSuperOps<{ request: SupportRequestDetail }>({
    action: "update_support_request",
    payload,
  });
