export type QuickReturnAuditAction = "admin_return" | "quick_return";

export const buildQuickReturnAuditRecord = (input: {
  workspaceId: string;
  actorId: string;
  operationId: string;
  operationFingerprint: string;
  actionType: QuickReturnAuditAction;
  processedCount: number;
}) => {
  if (
    !Number.isInteger(input.processedCount) || input.processedCount < 1 ||
    input.processedCount > 100 || input.operationId.length > 128 ||
    !/^[a-f0-9]{64}$/.test(input.operationFingerprint)
  ) {
    throw new Error("Invalid server checkout audit context.");
  }

  return {
    workspace_id: input.workspaceId,
    actor_id: input.actorId,
    action_type: "quick_return",
    entity_type: "items",
    entity_id: null,
    metadata: {
      source: "server_checkout",
      operation_id: input.operationId,
      operation_fingerprint: input.operationFingerprint,
      checkout_action: input.actionType,
      count: input.processedCount,
    },
  };
};
