import {
  optionalText,
  requireEmail,
  requireUuid,
  ValidationError,
} from "../_shared/validation.ts";

export type TenantAccount = {
  id: string;
  workspace_id: string;
  workspace_name: string | null;
  auth_email: string;
  role: "tenant_account";
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
};

export type TenantAccountRepository = {
  list(filters: { workspaceId: string | null; search: string }): Promise<TenantAccount[]>;
  create(workspaceId: string, email: string): Promise<TenantAccount>;
  findActive(id: string): Promise<TenantAccount | null>;
  setStatus(id: string, isActive: boolean): Promise<TenantAccount>;
  updateEmail(id: string, email: string): Promise<TenantAccount>;
  sendReset(email: string): Promise<void>;
  softDelete(id: string, at: string): Promise<void>;
  revokeSessions(id: string, actorId: string, at: string): Promise<void>;
  audit(action: string, id: string, metadata: Record<string, unknown>): Promise<void>;
};

type Context = {
  actorId: string;
  now: () => string;
  repository: TenantAccountRepository;
};

type Result =
  | { handled: false }
  | { handled: true; status: number; data?: unknown; error?: string };

const actions = new Set([
  "list_tenant_accounts",
  "create_tenant_account",
  "set_tenant_account_status",
  "update_tenant_account_email",
  "send_tenant_account_reset",
  "remove_tenant_account",
]);

export const handleTenantAccountAction = async (
  action: string,
  payload: Record<string, unknown>,
  context: Context,
): Promise<Result> => {
  if (!actions.has(action)) return { handled: false };

  const { repository } = context;
  if (action === "list_tenant_accounts") {
    const rawWorkspaceId = optionalText(payload.workspace_id, { maxLen: 36 });
    const workspaceId = rawWorkspaceId && rawWorkspaceId !== "all"
      ? requireUuid(rawWorkspaceId)
      : null;
    const search = optionalText(payload.search, { maxLen: 120 }).toLowerCase();
    return {
      handled: true,
      status: 200,
      data: await repository.list({ workspaceId, search }),
    };
  }

  if (action === "create_tenant_account") {
    const workspaceId = requireUuid(payload.workspace_id);
    const email = requireEmail(payload.auth_email);
    const created = await repository.create(workspaceId, email);
    await repository.audit(action, created.id, {
      workspace_id: workspaceId,
      auth_email: email,
    });
    return { handled: true, status: 200, data: created };
  }

  const id = requireUuid(payload.id);
  const target = await repository.findActive(id);
  if (!target) {
    return { handled: true, status: 404, error: "Tenant Account not found." };
  }

  if (action === "set_tenant_account_status") {
    if (typeof payload.is_active !== "boolean") {
      throw new ValidationError("Invalid request");
    }
    const updated = await repository.setStatus(id, payload.is_active);
    await repository.audit(action, id, { is_active: payload.is_active });
    return { handled: true, status: 200, data: updated };
  }

  if (action === "update_tenant_account_email") {
    const email = requireEmail(payload.auth_email);
    if (email === target.auth_email.toLowerCase()) {
      return { handled: true, status: 200, data: target };
    }
    const updated = await repository.updateEmail(id, email);
    await repository.audit(action, id, { auth_email: email });
    return { handled: true, status: 200, data: updated };
  }

  if (action === "send_tenant_account_reset") {
    await repository.sendReset(target.auth_email);
    await repository.audit(action, id, {});
    return { handled: true, status: 200, data: { success: true } };
  }

  const at = context.now();
  await repository.softDelete(id, at);
  await repository.revokeSessions(id, context.actorId, at);
  await repository.audit(action, id, {});
  return { handled: true, status: 200, data: { success: true } };
};
