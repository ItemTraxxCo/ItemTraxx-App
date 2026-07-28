import {
  classifyOfflineItem,
  containsQuickReturn,
  intendedState,
  parseSyncOperations,
} from "./contracts.ts";

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

const ITEM_ID = "50000000-0000-4000-8000-000000000001";
const BORROWER_ID = "60000000-0000-4000-8000-000000000001";

const checkoutItem = {
  item_id: ITEM_ID,
  barcode: "CAM-1",
  intent: "checkout" as const,
  borrower_id: BORROWER_ID,
  expected_status: "available",
  expected_checked_out_by: null,
};

Deno.test("offline sync parser accepts explicit per-item intent", () => {
  const result = parseSyncOperations([{
    operation_id: "op-1",
    created_at: "2026-07-28T09:00:00.000Z",
    items: [checkoutItem],
  }]);
  assertEquals(result[0].items[0].intent, "checkout");
  assertEquals(result[0].items[0].borrower_id, BORROWER_ID);
});

Deno.test("offline sync parser rejects auto intent", () => {
  let rejected = false;
  try {
    parseSyncOperations([{
      operation_id: "op-1",
      created_at: "2026-07-28T09:00:00.000Z",
      items: [{ ...checkoutItem, intent: "auto" }],
    }]);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});

Deno.test("offline item classification is safe, idempotent, or reviewable", () => {
  assertEquals(
    classifyOfflineItem(checkoutItem, {
      status: "available",
      checked_out_by: null,
    }),
    "apply",
  );
  assertEquals(
    classifyOfflineItem(checkoutItem, intendedState(checkoutItem)),
    "idempotent",
  );
  assertEquals(
    classifyOfflineItem(checkoutItem, {
      status: "checked_out",
      checked_out_by: "60000000-0000-4000-8000-000000000002",
    }),
    "needs_review",
  );
});

Deno.test("offline return may identify the borrower from the local snapshot", () => {
  const [operation] = parseSyncOperations([{
    operation_id: "op-return",
    created_at: "2026-07-28T10:00:00.000Z",
    items: [{
      item_id: ITEM_ID,
      barcode: "CAM-1",
      intent: "return",
      borrower_id: BORROWER_ID,
      expected_status: "checked_out",
      expected_checked_out_by: BORROWER_ID,
    }],
  }]);
  assertEquals(intendedState(operation.items[0]), {
    status: "available",
    checked_out_by: null,
  });
});

Deno.test("offline Quick Return preserves its explicit source intent", () => {
  const [operation] = parseSyncOperations([{
    operation_id: "op-quick-return",
    created_at: "2026-07-28T10:00:00.000Z",
    items: [{
      item_id: ITEM_ID,
      barcode: "CAM-1",
      intent: "quick_return",
      borrower_id: BORROWER_ID,
      expected_status: "checked_out",
      expected_checked_out_by: BORROWER_ID,
    }],
  }]);
  assertEquals(operation.items[0].intent, "quick_return");
  assertEquals(containsQuickReturn([operation]), true);
  assertEquals(intendedState(operation.items[0]), {
    status: "available",
    checked_out_by: null,
  });
});

Deno.test("offline return rejects a snapshot without its original borrower", () => {
  let rejected = false;
  try {
    parseSyncOperations([{
      operation_id: "op-bad-return",
      created_at: "2026-07-28T10:00:00.000Z",
      items: [{
        item_id: ITEM_ID,
        barcode: "CAM-1",
        intent: "return",
        borrower_id: BORROWER_ID,
        expected_status: "checked_out",
        expected_checked_out_by: null,
      }],
    }]);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});
