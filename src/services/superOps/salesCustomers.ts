import { callSuperOps } from "./client";
import type {
  CustomerInvoiceStatus,
  CustomerRecord,
  CustomerStatusLog,
  SalesLead,
} from "./types";

export type {
  CustomerInvoiceStatus,
  CustomerRecord,
  CustomerStatusLog,
  SalesLead,
} from "./types";

export const listSalesLeads = async (payload: { search?: string; limit?: number } = {}) =>
  callSuperOps<{ leads: SalesLead[] }>({
    action: "list_sales_leads",
    payload,
  });

export const setSalesLeadStage = async (payload: {
  lead_id: string;
  stage:
    | "waiting_for_quote"
    | "quote_generated"
    | "quote_sent"
    | "quote_converted_to_invoice"
    | "invoice_sent"
    | "invoice_paid";
}) =>
  callSuperOps<{ lead: SalesLead }>({
    action: "set_sales_lead_stage",
    payload,
  });

export const closeSalesLead = async (payload: { lead_id: string }) =>
  callSuperOps<{ lead: SalesLead }>({
    action: "close_sales_lead",
    payload,
  });

export const moveSalesLeadToCustomer = async (payload: { lead_id: string }) =>
  callSuperOps<{ lead: SalesLead }>({
    action: "move_sales_lead_to_customer",
    payload,
  });

export const listCustomers = async (payload: { search?: string; limit?: number } = {}) =>
  callSuperOps<{ customers: CustomerRecord[] }>({
    action: "list_customers",
    payload,
  });

export const addCustomerStatusEntry = async (payload: {
  lead_id: string;
  invoice_id: string;
  status: CustomerInvoiceStatus;
}) =>
  callSuperOps<{ entry: CustomerStatusLog }>({
    action: "add_customer_status_entry",
    payload,
  });
