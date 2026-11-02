import {
  isMissingPostgrestRelation as isMissingRelation,
} from "../../_shared/postgrestErrors.ts";
import { writeSecurityAuditEntries } from "../../_shared/securityAudit.ts";
import type { AdminOpsContext, RpcError } from "../context.ts";

export const handleStatusTrackingAction = async (
  context: AdminOpsContext,
): Promise<Response> => {
  const [flaggedResult, historyBaseResult] = await Promise.all([
    context.adminClient
      .from("items")
      .select(
        "id, name, barcode, serial_number, status, notes, created_at",
      )
      .eq("workspace_id", context.workspaceId)
      .is("deleted_at", null)
      .not("status", "in", "(available,checked_out)")
      .order("created_at", { ascending: false })
      .limit(400),
    context.adminClient
      .from("item_status_history")
      .select("id, item_id, status, note, changed_at, changed_by")
      .eq("workspace_id", context.workspaceId)
      .order("changed_at", { ascending: false })
      .limit(600),
  ]);

  let flaggedItems: Array<{
    id: string;
    name: string;
    barcode: string;
    serial_number: string | null;
    status: string;
    notes: string | null;
    updated_at: string;
  }> = [];

  if (flaggedResult.error) {
    console.error("admin-ops get_status_tracking flagged query failed", {
      message: flaggedResult.error.message,
      code: flaggedResult.error.code,
    });
    return context.jsonResponse(400, {
      error: "Unable to load status tracking.",
    });
  } else {
    flaggedItems = ((flaggedResult.data ?? []) as Array<{
      id: string;
      name: string;
      barcode: string;
      serial_number: string | null;
      status: string;
      notes: string | null;
      created_at?: string | null;
    }>).map((item) => ({
      id: item.id,
      name: item.name,
      barcode: item.barcode,
      serial_number: item.serial_number,
      status: item.status,
      notes: item.notes,
      updated_at: item.created_at ?? new Date().toISOString(),
    }));
    await writeSecurityAuditEntries(context.adminClient, flaggedItems.map((item) => ({
      actor_id: context.user.id,
      workspace_id: context.workspaceId,
      action: "read_list",
      target_type: "item",
      target_resource_id: item.id,
      route: "/functions/admin-ops",
      method: "POST",
      request_id: context.requestId,
    })));
  }

  let history: Array<{
    id: string;
    item_id: string;
    status: string;
    note: string | null;
    changed_at: string;
    changed_by: string | null;
    item: { name: string; barcode: string } | null;
  }> = [];

  if (historyBaseResult.error) {
    if (
      !isMissingRelation(
        historyBaseResult.error as RpcError,
        "item_status_history",
      )
    ) {
      console.error("admin-ops get_status_tracking history query failed", {
        message: historyBaseResult.error.message,
        code: historyBaseResult.error.code,
      });
      return context.jsonResponse(400, {
        error: "Unable to load status tracking.",
      });
    }
  } else {
    const historyRows = (historyBaseResult.data ?? []) as Array<{
      id: string;
      item_id: string;
      status: string;
      note: string | null;
      changed_at: string;
      changed_by: string | null;
    }>;
    const historyItemIds = Array.from(new Set(historyRows.map((row) => row.item_id)));
    await writeSecurityAuditEntries(context.adminClient, historyItemIds.map((id) => ({
      actor_id: context.user.id,
      workspace_id: context.workspaceId,
      action: "read_status_history",
      target_type: "item",
      target_resource_id: id,
      route: "/functions/admin-ops",
      method: "POST",
      request_id: context.requestId,
    })));
    const { data: itemRows } = historyItemIds.length
      ? await context.adminClient.from("items").select("id, name, barcode").in(
        "id",
        historyItemIds,
      )
      : { data: [] };
    const itemMap = new Map(
      ((itemRows ?? []) as Array<{
        id: string;
        name: string;
        barcode: string;
      }>).map((row) => [
        row.id,
        { name: row.name, barcode: row.barcode },
      ]),
    );
    history = historyRows.map((row) => ({
      ...row,
      item: itemMap.get(row.item_id) ?? null,
    }));
  }

  return context.jsonResponse(200, {
    data: { flagged_items: flaggedItems, history },
  });
};
