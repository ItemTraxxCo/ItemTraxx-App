import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

export type SupabaseAdminClient = ReturnType<typeof createClient<any>>;

export type JsonResponse = (
  status: number,
  body: Record<string, unknown>,
) => Response;

export type WriteSuperAudit = (
  actionType: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown>,
) => Promise<void>;

export type SuperOpsContext = {
  req: Request;
  action: string;
  payload: Record<string, unknown>;
  adminClient: SupabaseAdminClient;
  user: { id: string; email?: string | null };
  profile: { auth_email?: string | null };
  accessToken: string;
  supabaseUrl: string;
  publishableKey: string | null;
  jsonResponse: JsonResponse;
  writeAudit: WriteSuperAudit;
};
