import { buildQuickReturnAuditRecord } from "./adminAudit.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("quick return audit records use server-derived bounded fields", () => {
  const actual = buildQuickReturnAuditRecord({
      workspaceId: "workspace-1",
      actorId: "profile-1",
      operationId: "operation-1",
      operationFingerprint: "a".repeat(64),
      actionType: "admin_return",
      processedCount: 4,
    });
  assert(
    JSON.stringify(actual) === JSON.stringify({
      workspace_id: "workspace-1",
      actor_id: "profile-1",
      action_type: "quick_return",
      entity_type: "items",
      entity_id: null,
      metadata: {
        source: "server_checkout",
        operation_id: "operation-1",
        operation_fingerprint: "a".repeat(64),
        checkout_action: "admin_return",
        count: 4,
      },
    }),
    "expected a fixed audit event using the authenticated context and bounded summary",
  );
});

Deno.test("quick return audit rejects counts outside the checkout request bound", () => {
  let didThrow = false;
  try {
    buildQuickReturnAuditRecord({
      workspaceId: "workspace-1",
      actorId: "profile-1",
      operationId: "operation-1",
      operationFingerprint: "a".repeat(64),
      actionType: "quick_return",
      processedCount: 101,
    })
  } catch {
    didThrow = true;
  }
  assert(didThrow, "expected the over-limit count to be rejected");
});
