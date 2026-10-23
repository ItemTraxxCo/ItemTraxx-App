import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";

type EmailChangeAction = "request" | "approve" | "verify";

const callAccountEmailChange = async (body: Record<string, string>) => {
  const result = await invokeEdgeFunction<{
    success?: boolean;
    message?: string;
  }, Record<string, string>>("account-email-change", {
    method: "POST",
    body,
  });
  if (!result.ok) {
    throw edgeFunctionError(
      result,
      "Unable to complete this email change. Please try again.",
    );
  }
  return result.data;
};

export const requestAccountEmailChange = async (newEmail: string) => {
  const result = await callAccountEmailChange({
    action: "request",
    new_email: newEmail.trim(),
  });
  return result?.message ?? "Approval instructions were sent to your current email address.";
};

export const completeAccountEmailChangeStep = (
  action: Exclude<EmailChangeAction, "request">,
  token: string,
) => callAccountEmailChange({ action, token });
