import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";

export type ContactSupportPayload = {
  name: string;
  reply_email: string;
  subject: string;
  category: "general" | "bug" | "billing" | "access" | "feature" | "other";
  message: string;
  turnstile_token: string;
  website?: string;
  attachments?: Array<{
    filename: string;
    content_type: string;
    content_base64: string;
    size_bytes: number;
  }>;
};

type ContactSupportResponse = {
  ok: boolean;
  data?: { accepted: boolean; request_id?: string };
  error?: string;
};

export const submitContactSupportRequest = async (payload: ContactSupportPayload) => {
  const result = await invokeEdgeFunction<ContactSupportResponse, ContactSupportPayload>(
    "contact-support-submit",
    {
      method: "POST",
      body: payload,
    }
  );

  if (!result.ok || !result.data?.ok) {
    throw edgeFunctionError(result, result.data?.error || "Unable to send support request.");
  }

  return result.data.data ?? null;
};
