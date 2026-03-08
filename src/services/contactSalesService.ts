import { invokeEdgeFunction } from "./edgeFunctionClient";

type ContactSalesPayload = {
  plan:
    | "district_core"
    | "district_growth"
    | "district_enterprise"
    | "organization_starter"
    | "organization_scale"
    | "organization_enterprise"
    | "individual_yearly"
    | "individual_monthly"
    | "other";
  name: string;
  organization: string;
  reply_email: string;
  details: string;
  schools_count?: number | null;
  turnstile_token: string;
  website?: string;
  intent?: "sales" | "demo";
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
