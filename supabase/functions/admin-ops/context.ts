import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

export type SupabaseClient = ReturnType<typeof createClient<any>>;

export type JsonResponse = (
  status: number,
  body: Record<string, unknown>,
) => Response;

export type TenantFeatureFlags = {
  enable_notifications: boolean;
  enable_bulk_item_import: boolean;
  enable_bulk_student_tools: boolean;
  enable_status_tracking: boolean;
  enable_barcode_generator: boolean;
};

export type TenantPolicyRow = {
  checkout_due_hours: number | null;
  account_category: "organization" | "district" | "individual" | null;
  plan_code:
    | "core"
    | "growth"
    | "starter"
    | "scale"
    | "enterprise"
    | "individual_yearly"
    | "individual_monthly"
    | null;
  feature_flags: unknown;
};

export type RuntimeUpdateItem = {
  id: string;
  title: string;
  message: string;
  level: "info" | "warning" | "critical";
  created_at: string;
  link_url: string | null;
};

export type DeviceSessionContext = {
  deviceId: string | null;
  deviceLabel: string | null;
  userAgent: string | null;
  loginMethod: "password" | "magic_link" | "session_handoff" | null;
  loginLocation: "regular_login" | "admin_login" | null;
  generalLocation: string | null;
};

export type AdminOpsContext = {
  requestId: string;
  action: string;
  payload: Record<string, unknown>;
  adminClient: SupabaseClient;
  user: { id: string };
  tenantId: string;
  authToken: string;
  authSessionBinding: { sessionId: string | null; issuedAt: string | null };
  authTokenBindingKey: string;
  deviceSession: DeviceSessionContext;
  tenantPolicy: TenantPolicyRow | null;
  checkoutDueHours: number;
  featureFlags: TenantFeatureFlags;
  maintenance: { enabled: boolean; message: string };
  tenantUpdates: RuntimeUpdateItem[];
  jsonResponse: JsonResponse;
};

export type RpcError = {
  code?: string;
  message?: string;
};
