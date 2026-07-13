import {
  isMissingPostgrestColumn as isMissingColumn,
  isMissingPostgrestRelation as isMissingRelation,
} from "../../_shared/postgrestErrors.ts";
import type { AdminOpsContext, RpcError } from "../context.ts";

export const handleStatusTrackingAction = async (
  context: AdminOpsContext,
): Promise<Response> => {
  const [flaggedResult, historyBaseResult] = await Promise.all([
    context.adminClient
      .from("gear")
      .select(
        "id, name, barcode, serial_number, status, notes, updated_at, created_at",
      )
      .eq("tenant_id", context.tenantId)
      .is("deleted_at", null)
      .not("status", "in", "(available,checked_out)")
      .order("updated_at", { ascending: false })
      .limit(400),
    context.adminClient
      .from("gear_status_history")
      .select("id, gear_id, status, note, changed_at, changed_by")
      .eq("tenant_id", context.tenantId)
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
    if (isMissingColumn(flaggedResult.error as RpcError, "updated_at")) {
      const fallbackFlagged = await context.adminClient
        .from("gear")
        .select("id, name, barcode, serial_number, status, notes, created_at")
        .eq("tenant_id", context.tenantId)
        .is("deleted_at", null)
        .not("status", "in", "(available,checked_out)")
        .order("created_at", { ascending: false })
        .limit(400);
      if (fallbackFlagged.error) {
        console.error("admin-ops get_status_tracking flagged fallback failed", {
          message: fallbackFlagged.error.message,
          code: fallbackFlagged.error.code,
        });
        return context.jsonResponse(400, {
          error: "Unable to load status tracking.",
        });
      }
      flaggedItems = ((fallbackFlagged.data ?? []) as Array<{
        id: string;
        name: string;
        barcode: string;
        serial_number: string | null;
        status: string;
        notes: string | null;
        created_at: string;
      }>).map((item) => ({ ...item, updated_at: item.created_at }));
    } else {
      console.error("admin-ops get_status_tracking flagged query failed", {
        message: flaggedResult.error.message,
        code: flaggedResult.error.code,
      });
      return context.jsonResponse(400, {
        error: "Unable to load status tracking.",
      });
    }
  } else {
    flaggedItems = ((flaggedResult.data ?? []) as Array<{
      id: string;
      name: string;
      barcode: string;
      serial_number: string | null;
      status: string;
      notes: string | null;
      updated_at?: string | null;
      created_at?: string | null;
    }>).map((item) => ({
      id: item.id,
      name: item.name,
      barcode: item.barcode,
      serial_number: item.serial_number,
      status: item.status,
      notes: item.notes,
      updated_at: item.updated_at ?? item.created_at ??
        new Date().toISOString(),
    }));
  }

  let history: Array<{
    id: string;
    gear_id: string;
    status: string;
    note: string | null;
    changed_at: string;
    changed_by: string | null;
    gear: { name: string; barcode: string } | null;
  }> = [];

  if (historyBaseResult.error) {
    if (
      !isMissingRelation(
        historyBaseResult.error as RpcError,
        "gear_status_history",
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
      gear_id: string;
      status: string;
      note: string | null;
      changed_at: string;
      changed_by: string | null;
    }>;
    const gearIds = Array.from(new Set(historyRows.map((row) => row.gear_id)));
    const { data: gearRows } = gearIds.length
      ? await context.adminClient.from("gear").select("id, name, barcode").in(
        "id",
        gearIds,
      )
      : { data: [] };
    const gearMap = new Map(
      ((gearRows ?? []) as Array<{
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
      gear: gearMap.get(row.gear_id) ?? null,
    }));
  }

  return context.jsonResponse(200, {
    data: { flagged_items: flaggedItems, history },
  });
};
