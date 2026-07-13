import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

export type SupabaseClient = ReturnType<typeof createClient<any>>;

export type JsonResponse = (
  status: number,
  body: Record<string, unknown> & { ok?: boolean },
) => Response;

export type WriteSuperTenantAudit = (
  actionType: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown>,
) => Promise<void>;

export type SuperTenantContext = {
  req: Request;
  action: string;
  payload: Record<string, unknown>;
  userClient: SupabaseClient;
  adminClient: SupabaseClient;
  user: { id: string; email?: string | null };
  profile: { auth_email?: string | null };
  jsonResponse: JsonResponse;
  writeAudit: WriteSuperTenantAudit;
  resetRedirectTo: string | null;
  supabaseUrl: string;
  publishableKey: string;
};

export type PgError = {
  code?: string;
  message?: string;
};

export type TenantRow = {
  id: string;
  name: string;
  access_code: string;
  status?: "active" | "suspended" | "archived";
  created_at: string;
  district_id?: string | null;
  district_name?: string | null;
  district_slug?: string | null;
  primary_admin_profile_id?: string | null;
};

export type DistrictRow = {
  id: string;
  name: string;
  slug: string;
  support_email?: string | null;
  contact_name?: string | null;
  is_active?: boolean;
  created_at?: string;
  subscription_plan?:
    | "district_core"
    | "district_growth"
    | "district_enterprise"
    | "organization_starter"
    | "organization_scale"
    | "organization_enterprise"
    | null;
  billing_status?: "draft" | "active" | "past_due" | "canceled" | null;
  renewal_date?: string | null;
  billing_email?: string | null;
  invoice_reference?: string | null;
};
