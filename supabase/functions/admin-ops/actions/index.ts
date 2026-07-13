import type {
  AdminOpsContext,
  JsonResponse,
  SupabaseClient,
} from "../context.ts";

export const ADMIN_OPS_ACTIONS = [] as const;

export const ADMIN_OPS_ACTION_OWNERS: Record<string, string> = {};

export const authorizeAdminOpsAction = async (_input: {
  action: string;
  profileRole: "tenant_admin" | "tenant_user";
  isTenantSuspended: boolean;
  adminClient: SupabaseClient;
  userId: string;
  authToken: string;
  jsonResponse: JsonResponse;
}): Promise<Response | null> => null;

export const dispatchAdminOpsAction = (context: AdminOpsContext) =>
  Promise.resolve(context.jsonResponse(400, { error: "Invalid action" }));
