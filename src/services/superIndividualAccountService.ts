import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";

export type SuperIndividualAccount = {
  id: string;
  name: string;
  status: "active" | "suspended";
  archived_at: string | null;
  created_at: string;
  primary_admin_profile_id: string | null;
  primary_admin_email: string | null;
  account_category: "individual";
  plan_code?: "individual_yearly" | "individual_monthly" | null;
  max_items?: number | null;
  max_borrowers?: number | null;
  checkout_due_hours?: number;
  feature_flags?: Record<string, boolean>;
  contact_name?: string | null;
  support_email?: string | null;
  billing_email?: string | null;
  billing_status?: "draft" | "active" | "past_due" | "canceled" | null;
  renewal_date?: string | null;
  invoice_reference?: string | null;
};

export type IndividualAccountPolicyInput = {
  plan_code?: "individual_yearly" | "individual_monthly" | null;
  max_items?: number | null;
  max_borrowers?: number | null;
  checkout_due_hours: number;
  feature_flags: Record<string, boolean>;
  contact_name?: string | null;
  support_email?: string | null;
  billing_email?: string | null;
  billing_status?: "draft" | "active" | "past_due" | "canceled" | null;
  renewal_date?: string | null;
  invoice_reference?: string | null;
};

export type IndividualAccountCreateInput = IndividualAccountPolicyInput & {
  name: string;
  auth_email: string;
  password?: string;
};

export type IndividualAccountUpdateInput = IndividualAccountPolicyInput & {
  id: string;
  name: string;
  auth_email: string;
};

const call = async <T>(action: string, payload: Record<string, unknown>) => {
  const result = await invokeEdgeFunction<
    { data: T },
    { action: string; payload: Record<string, unknown> }
  >("super-workspace-mutate", {
    method: "POST",
    body: { action, payload },
    avoidCorsPreflight: true,
  });
  if (!result.ok) throw edgeFunctionError(result, "Super Admin individual account request failed.");
  return result.data!.data;
};

export const listIndividualAccounts = (search = "", status = "all") =>
  call<SuperIndividualAccount[]>("list_individual_accounts", { search, status });

export const createIndividualAccount = (payload: IndividualAccountCreateInput) =>
  call<SuperIndividualAccount>("create_individual_account", payload);

export const updateIndividualAccount = (payload: IndividualAccountUpdateInput) =>
  call<SuperIndividualAccount>("update_individual_account", payload);

export const setIndividualAccountStatus = (id: string, status: string) =>
  call<SuperIndividualAccount>("set_individual_account_status", { id, status });

export const sendIndividualAccountReset = (id: string) =>
  call<{ success: boolean; auth_email: string }>("send_individual_account_reset", { id });
