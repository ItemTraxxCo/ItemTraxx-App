import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";

export const acceptWorkspaceInvitation = async (token: string, password: string) => {
  const result = await invokeEdgeFunction<
    { success?: boolean },
    { token: string; password: string }
  >("workspace-invitation", {
    method: "POST",
    body: { token, password },
  });
  if (!result.ok) {
    throw edgeFunctionError(
      result,
      "This invitation cannot be accepted. Request a new invitation or contact the workspace admin.",
    );
  }
  return result.data;
};
