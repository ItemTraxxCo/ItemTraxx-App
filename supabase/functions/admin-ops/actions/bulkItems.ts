import {
  BARCODE_PATTERN,
  optionalText,
  requireEnum,
  requireText,
} from "../../_shared/validation.ts";
import type { AdminOpsContext } from "../context.ts";
import { preflightQuota, quotaLimitResponse, quotaPreflightResponse } from "../../_shared/quota.ts";

const ALLOWED_ITEM_STATUSES = new Set(
  [
    "available",
    "checked_out",
    "damaged",
    "lost",
    "in_repair",
    "retired",
    "in_studio_only",
  ] as const,
);

export const handleBulkItemsAction = async (
  context: AdminOpsContext,
): Promise<Response> => {
  if (!context.featureFlags.enable_bulk_item_import) {
    return context.jsonResponse(403, {
      error: "Bulk item import is disabled for this workspace.",
    });
  }

  const rawRows = Array.isArray(context.payload.rows)
    ? context.payload.rows
    : [];
  if (!rawRows.length || rawRows.length > 1000) {
    return context.jsonResponse(400, {
      error: "Provide between 1 and 1000 rows.",
    });
  }

  const skippedRows: Array<{ barcode: string; reason: string }> = [];
  const normalizedRows: Array<{
    name: string;
    barcode: string;
    serial_number: string | null;
    status: string;
    notes: string | null;
  }> = [];
  const seenBarcodes = new Set<string>();

  for (const row of rawRows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      skippedRows.push({ barcode: "(invalid)", reason: "Invalid row." });
      continue;
    }
    const rowRecord = row as Record<string, unknown>;
    let name = "";
    let barcode = "";
    let serial = "";
    let statusRaw:
      | "available"
      | "checked_out"
      | "damaged"
      | "lost"
      | "in_repair"
      | "retired"
      | "in_studio_only";
    let notes = "";
    try {
      name = requireText(rowRecord.name, { maxLen: 120 });
      barcode = requireText(rowRecord.barcode, {
        maxLen: 64,
        pattern: BARCODE_PATTERN,
      });
      serial = optionalText(rowRecord.serial_number, { maxLen: 64 });
      statusRaw = requireEnum(
        rowRecord.status ?? "available",
        ALLOWED_ITEM_STATUSES,
      );
      notes = optionalText(rowRecord.notes, { maxLen: 500 });
    } catch {
      skippedRows.push({
        barcode: barcode || "(blank)",
        reason: "Invalid row.",
      });
      continue;
    }
    if (seenBarcodes.has(barcode.toLowerCase())) {
      skippedRows.push({ barcode, reason: "Duplicate barcode in import." });
      continue;
    }
    seenBarcodes.add(barcode.toLowerCase());
    normalizedRows.push({
      name,
      barcode,
      serial_number: serial || null,
      status: statusRaw,
      notes: notes || null,
    });
  }

  if (!normalizedRows.length) {
    return context.jsonResponse(200, {
      data: {
        inserted: 0,
        skipped: skippedRows.length,
        inserted_items: [],
        skipped_rows: skippedRows,
      },
    });
  }

  const lookupBarcodes = normalizedRows.map((row) => row.barcode);
  const { data: existingRows } = await context.adminClient
    .from("items")
    .select("barcode")
    .eq("workspace_id", context.workspaceId)
    .in("barcode", lookupBarcodes);
  const existing = new Set(
    (existingRows ?? []).map((row) => (row as { barcode: string }).barcode),
  );
  const toInsert = normalizedRows.filter((row) => {
    const isExisting = existing.has(row.barcode);
    if (isExisting) {
      skippedRows.push({
        barcode: row.barcode,
        reason: "Barcode already exists.",
      });
    }
    return !isExisting;
  });

  if (!toInsert.length) {
    return context.jsonResponse(200, {
      data: {
        inserted: 0,
        skipped: skippedRows.length,
        inserted_items: [],
        skipped_rows: skippedRows,
      },
    });
  }

  const quotaLimit = await preflightQuota(
    context.adminClient,
    context.workspaceId,
    "items",
    toInsert.length,
  );
  if (quotaLimit) return quotaPreflightResponse(quotaLimit, context.jsonResponse);

  const { data: insertedRows, error: importError } = await context.adminClient.rpc(
    "import_items_with_audit",
    {
      p_workspace_id: context.workspaceId,
      p_actor_id: context.user.id,
      p_items: toInsert,
      p_skipped_count: skippedRows.length,
    },
  );
  if (importError) {
    const quotaResponse = quotaLimitResponse(importError, context.jsonResponse);
    if (quotaResponse) return quotaResponse;
    console.error("admin-ops transactional bulk import failed", {
      request_id: context.requestId,
      workspace_id: context.workspaceId,
      profile_id: context.user.id,
      error: importError,
    });
    return context.jsonResponse(400, { error: "Unable to import item rows." });
  }
  if (!Array.isArray(insertedRows) || insertedRows.length !== toInsert.length) {
    console.error("admin-ops transactional bulk import returned an invalid row set", {
      request_id: context.requestId,
      workspace_id: context.workspaceId,
      profile_id: context.user.id,
      expected_rows: toInsert.length,
      returned_rows: Array.isArray(insertedRows) ? insertedRows.length : null,
    });
    return context.jsonResponse(500, {
      error: "Unable to import item rows.",
    });
  }

  const insertedCount = insertedRows.length;

  return context.jsonResponse(200, {
    data: {
      inserted: insertedCount,
      skipped: skippedRows.length,
      inserted_items: insertedRows,
      skipped_rows: skippedRows,
    },
  });
};
