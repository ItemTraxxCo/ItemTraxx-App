import { invokeEdgeFunction } from "./edgeFunctionClient";

type ContactSalesPayload = {
  plan: "core" | "growth" | "enterprise";
  name: string;
  organization: string;
  reply_email: string;
  details: string;
  schools_count?: number | null;
  turnstile_token: string;
  website?: string;
};

type ContactSalesResponse = {
  ok: boolean;
  data?: { lead_id: string };
  error?: string;
};

export const submitContactSalesLead = async (payload: ContactSalesPayload) => {
  const result = await invokeEdgeFunction<ContactSalesResponse, ContactSalesPayload>(
    "contact-sales-submit",
    {
      method: "POST",
      body: payload,
    }
  );

  if (!result.ok || !result.data?.ok) {
    throw new Error(result.error || result.data?.error || "Unable to send sales request.");
  }

  return result.data.data ?? null;
};
