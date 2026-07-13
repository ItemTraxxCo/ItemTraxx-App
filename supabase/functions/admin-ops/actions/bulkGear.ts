import {
  BARCODE_PATTERN,
  optionalText,
  requireEnum,
  requireText,
} from "../../_shared/validation.ts";
import type { AdminOpsContext } from "../context.ts";

const TRACKED_STATUSES = new Set([
  "damaged",
  "lost",
  "in_repair",
  "retired",
  "in_studio_only",
]);

const ALLOWED_GEAR_STATUSES = new Set(
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

export const handleBulkGearAction = async (
  context: AdminOpsContext,
): Promise<Response> => {
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
        ALLOWED_GEAR_STATUSES,
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
    .from("gear")
    .select("barcode")
    .eq("tenant_id", context.tenantId)
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

  const insertPayload = toInsert.map((row) => ({
    tenant_id: context.tenantId,
    name: row.name,
    barcode: row.barcode,
    serial_number: row.serial_number,
    status: row.status,
    notes: row.notes,
  }));
  const { data: insertedRows, error: insertError } = await context.adminClient
    .from("gear")
    .insert(insertPayload)
    .select("id, tenant_id, name, barcode, serial_number, status, notes");
  if (insertError) {
    return context.jsonResponse(400, { error: "Unable to import item rows." });
  }

  const historyPayload = (insertedRows ?? [])
    .filter((item) => TRACKED_STATUSES.has((item as { status: string }).status))
    .map((item) => ({
      tenant_id: context.tenantId,
      gear_id: (item as { id: string }).id,
      status: (item as { status: string }).status,
      note: (item as { notes?: string | null }).notes ?? null,
      changed_by: context.user.id,
    }));
  if (historyPayload.length) {
    await context.adminClient.from("gear_status_history").insert(
      historyPayload,
    );
  }

  return context.jsonResponse(200, {
    data: {
      inserted: (insertedRows ?? []).length,
      skipped: skippedRows.length,
      inserted_items: insertedRows ?? [],
      skipped_rows: skippedRows,
    },
  });
};
