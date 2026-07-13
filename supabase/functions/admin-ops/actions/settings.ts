import type {
  SupabaseClient,
  TenantFeatureFlags,
  TenantPolicyRow,
} from "../context.ts";

export const resolveTenantPolicyState = async (
  _adminClient: SupabaseClient,
  _tenantId: string,
): Promise<{
  tenantPolicy: TenantPolicyRow | null;
  checkoutDueHours: number;
  featureFlags: TenantFeatureFlags;
}> => {
  throw new Error("Not implemented");
};
