import { invokeEdgeFunction } from "./edgeFunctionClient";
import type { EdgeEnvelope } from "../types/edgeContracts";
import { edgeFunctionError } from "./appErrors";
import { getActiveJitTokenForWorkspace } from "../store/jitAccessState";

export type SuperLogEntry = {
  id: string;
  workspace_id: string;
  item_id: string;
  checked_out_by: string | null;
  action_type: string;
  action_time: string;
  performed_by: string | null;
  item: { id: string; name: string; barcode: string } | null;
  borrower: { id: string; username: string; borrower_id: string } | null;
  workspace: { id: string; name: string } | null;
  pii_redacted?: boolean;
};

export const listSuperLogs = async (
  payload: {
    workspace_id?: string;
    action_type?: string;
    search?: string;
    start_at?: string;
    end_at?: string;
    page?: number;
    page_size?: number;
    include_payload?: boolean;
  },
  jitToken?: string | null,
) => {
  const resolvedToken = payload.include_payload
    ? (jitToken ??
      (payload.workspace_id && payload.workspace_id !== "all"
        ? getActiveJitTokenForWorkspace(payload.workspace_id, "read_only")
        : null))
    : null;
  const result = await invokeEdgeFunction<EdgeEnvelope<SuperLogEntry[]> & {
    data?: SuperLogEntry[];
    page?: number;
    page_size?: number;
    count?: number;
    payload_mode?: "metadata" | "decrypted";
    pii_redacted?: boolean;
  }>("super-logs-query", {
    method: "POST",
    body: { payload },
    ...(resolvedToken ? { headers: { "x-itx-jit-ticket": resolvedToken } } : {}),
  });

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to load logs.");
  }

  return {
    rows: result.data?.data ?? [],
    page: result.data?.page ?? 1,
    pageSize: result.data?.page_size ?? payload.page_size ?? 50,
    count: result.data?.count ?? 0,
    payloadMode: result.data?.payload_mode ?? "metadata",
    piiRedacted: result.data?.pii_redacted ?? true,
  };
};
