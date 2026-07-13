import type { SuperTenantContext } from "../context.ts";

export const resolveResetRedirectTo = (configured: string | undefined) => {
  const redirectTo = (configured ?? "").trim();
  return redirectTo || null;
};

export const handlePrimaryAdminAction = async (context: SuperTenantContext) =>
  context.jsonResponse(400, { error: "Invalid action" });
