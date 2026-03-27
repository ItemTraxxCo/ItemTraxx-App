import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";

export const registerPrivilegedAdminStepUp = async () => {
  const result = await invokeEdgeFunction<{ data?: { registered: boolean; expires_at: string } }>(
    "privileged-step-up",
    {
      method: "POST",
      body: {},
    },
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Unable to verify admin session.");
  }

  return result.data?.data ?? { registered: false, expires_at: "" };
};
