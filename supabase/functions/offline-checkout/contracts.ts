import {
  asRecord,
  requireEnum,
  requireText,
  requireUuid,
  ValidationError,
} from "../_shared/validation.ts";

const OFFLINE_INTENTS = new Set(
  ["checkout", "return", "quick_return"] as const,
);
const OFFLINE_RESOLUTIONS = new Set(
  ["keep_server", "apply_offline"] as const,
);

type OfflineIntent = "checkout" | "return" | "quick_return";
type OfflineResolution = "keep_server" | "apply_offline";

export type OfflineSyncItem = {
  item_id: string;
  barcode: string;
  intent: OfflineIntent;
  borrower_id: string | null;
  expected_status: string;
  expected_checked_out_by: string | null;
};

export type OfflineSyncOperation = {
  operation_id: string;
  created_at: string;
  items: OfflineSyncItem[];
};

export type OfflineItemState = {
  status: string;
  checked_out_by: string | null;
};

const nullableUuid = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  return requireUuid(value);
};

export const parseSyncOperations = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new ValidationError("Invalid offline operations.");
  }

  let totalItems = 0;
  const operationIds = new Set<string>();
  const operations = value.map((rawOperation) => {
    const operation = asRecord(rawOperation);
    const operationId = requireText(operation.operation_id, { maxLen: 128 });
    if (operationIds.has(operationId)) {
      throw new ValidationError("Duplicate offline operation.");
    }
    operationIds.add(operationId);

    const createdAt = requireText(operation.created_at, { maxLen: 40 });
    const createdAtMs = Date.parse(createdAt);
    if (Number.isNaN(createdAtMs)) {
      throw new ValidationError("Invalid offline operation timestamp.");
    }
    if (!Array.isArray(operation.items) || operation.items.length < 1) {
      throw new ValidationError("Offline operation has no items.");
    }
    totalItems += operation.items.length;
    if (totalItems > 100) {
      throw new ValidationError("Too many offline items.");
    }

    const itemIds = new Set<string>();
    const items = operation.items.map((rawItem) => {
      const item = asRecord(rawItem);
      const itemId = requireUuid(item.item_id);
      if (itemIds.has(itemId)) {
        throw new ValidationError("Duplicate item in offline operation.");
      }
      itemIds.add(itemId);
      const intent = requireEnum(item.intent, OFFLINE_INTENTS);
      const borrowerId = nullableUuid(item.borrower_id);
      const expectedCheckedOutBy = nullableUuid(item.expected_checked_out_by);
      if (!borrowerId) {
        throw new ValidationError("Offline transaction requires a borrower.");
      }
      const expectedStatus = requireText(item.expected_status, { maxLen: 32 });
      if (
        intent === "checkout" &&
        (expectedStatus !== "available" || expectedCheckedOutBy !== null)
      ) {
        throw new ValidationError("Offline checkout snapshot does not match.");
      }
      if (
        intent !== "checkout" &&
        (expectedStatus !== "checked_out" ||
          expectedCheckedOutBy === null ||
          borrowerId !== expectedCheckedOutBy)
      ) {
        throw new ValidationError("Offline return snapshot does not match.");
      }
      return {
        item_id: itemId,
        barcode: requireText(item.barcode, { maxLen: 64 }),
        intent,
        borrower_id: borrowerId,
        expected_status: expectedStatus,
        expected_checked_out_by: expectedCheckedOutBy,
      } satisfies OfflineSyncItem;
    });

    return {
      operation_id: operationId,
      created_at: new Date(createdAtMs).toISOString(),
      items,
    } satisfies OfflineSyncOperation;
  });

  return operations;
};

export const containsQuickReturn = (operations: OfflineSyncOperation[]) =>
  operations.some((operation) =>
    operation.items.some((item) => item.intent === "quick_return")
  );

export const parseResolvePayload = (body: Record<string, unknown>) => ({
  operationId: requireText(body.operation_id, { maxLen: 128 }),
  resolution: requireEnum(body.resolution, OFFLINE_RESOLUTIONS),
});

export const parseDeviceId = (value: unknown) =>
  requireText(value, { maxLen: 128 });

export const parsePackVersion = (value: unknown) => requireUuid(value);

export const intendedState = (item: OfflineSyncItem): OfflineItemState =>
  item.intent === "checkout"
    ? { status: "checked_out", checked_out_by: item.borrower_id }
    : { status: "available", checked_out_by: null };

const statesEqual = (left: OfflineItemState, right: OfflineItemState) =>
  left.status.toLowerCase() === right.status.toLowerCase() &&
  left.checked_out_by === right.checked_out_by;

export const classifyOfflineItem = (
  item: OfflineSyncItem,
  current: OfflineItemState,
) => {
  if (statesEqual(current, intendedState(item))) return "idempotent" as const;
  const expected = {
    status: item.expected_status,
    checked_out_by: item.expected_checked_out_by,
  };
  if (statesEqual(current, expected)) return "apply" as const;
  return "needs_review" as const;
};
