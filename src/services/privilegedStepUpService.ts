import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";

export const registerPrivilegedAdminStepUp = async (accessToken?: string) => {
  const result = await invokeEdgeFunction<{ data?: { registered: boolean; expires_at: string | null } }>(
    "privileged-step-up",
    {
      method: "POST",
      body: {},
      accessToken,
    },
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to verify account session. Please sign out and try again.");
  }

  return result.data?.data ?? { registered: false, expires_at: null };
};
