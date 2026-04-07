import { invokeEdgeFunction } from "./edgeFunctionClient";
import { edgeFunctionError } from "./appErrors";

export type RuntimeConfigMap = Record<string, unknown>;

export type SuperAlertRule = {
  id: string;
  name: string;
  metric_key: string;
  threshold: number;
  is_enabled: boolean;
  created_at: string;
};

export type SuperApproval = {
  id: string;
  action_type: string;
  payload: Record<string, unknown>;
  requested_by: string;
  approved_by: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
};

export type SuperJob = {
  id: string;
  job_type: string;
  status: string;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SalesLead = {
  id: string;
  plan: "core" | "growth" | "enterprise";
  lead_state: "open" | "closed" | "converted_to_customer";
  stage:
    | "waiting_for_quote"
    | "quote_generated"
    | "quote_sent"
    | "quote_converted_to_invoice"
    | "invoice_sent"
    | "invoice_paid";
  schools_count: number | null;
  name: string;
  organization: string;
  reply_email: string;
  details: string | null;
  source: string;
  created_at: string;
  updated_at: string | null;
};

export type CustomerInvoiceStatus =
  | "paid_on_time"
  | "paid_late"
  | "awaiting_payment"
  | "canceling";

export type CustomerStatusLog = {
  id: string;
  lead_id: string;
  invoice_id: string;
  status: CustomerInvoiceStatus;
  created_at: string;
  created_by: string | null;
};

export type CustomerRecord = {
  id: string;
  plan: SalesLead["plan"];
  lead_state: SalesLead["lead_state"];
  schools_count: number | null;
  name: string;
  organization: string;
  reply_email: string;
  stage: SalesLead["stage"];
  details: string | null;
  latest_status: CustomerInvoiceStatus | null;
  latest_invoice_id: string | null;
  status_logs: CustomerStatusLog[];
};

export type InternalOpsEvent = {
  tenant_id: string | null;
  tenant_name: string;
  action_type: "checkout" | "return";
  action_time: string;
  gear_name: string | null;
  gear_barcode: string | null;
  student_username: string | null;
  student_id: string | null;
};

export type InternalOpsSnapshot = {
  checked_at: string;
  traffic: {
    checkout_15m: number;
    return_15m: number;
    active_tenants_15m: number;
    events_24h: number;
  };
  queue: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
  };
  leads: {
    open: number;
    closed: number;
    converted: number;
    waiting_for_quote: number;
    quote_sent: number;
    invoice_sent: number;
    invoice_paid: number;
  };
  lead_funnel: {
    waiting_for_quote: number;
    quote_generated: number;
    quote_sent: number;
    quote_converted_to_invoice: number;
    invoice_sent: number;
    invoice_paid: number;
  };
  traffic_by_hour: Array<{
    hour: string;
    checkout: number;
    return: number;
  }>;
  sla: {
    median_latency_ms: number | null;
    p95_latency_ms: number | null;
    error_rate_percent: number;
    probe_latency_ms: number | null;
  };
  needs_attention: Array<{
    key: string;
    level: "high" | "medium" | "low";
    title: string;
    count: number;
    route: string;
  }>;
  customer_health: {
    total_customers: number;
    awaiting_payment: number;
    canceling: number;
    paid_late: number;
    paid_on_time: number;
    no_status: number;
  };
  recent_audit: Array<{
    id: string;
    actor_email: string | null;
    action_type: string;
    target_type: string | null;
    target_id: string | null;
    created_at: string;
  }>;
  search_index: Array<{
    id: string;
    label: string;
    type: "page" | "tenant" | "customer" | "lead";
    route: string;
  }>;
  runtime: Record<string, unknown>;
  recent_events: InternalOpsEvent[];
};

export type SupportRequestStatus = "open" | "in_progress" | "resolved" | "spam";

export type SupportRequestListItem = {
  id: string;
  requester_name: string;
  reply_email: string;
  subject: string;
  category: "general" | "bug" | "billing" | "access" | "feature" | "other";
  status: SupportRequestStatus;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
};

export type SupportRequestAttachment = {
  id: string;
  original_filename: string | null;
  stored_filename: string;
  content_type: string;
  size_bytes: number;
  signed_url: string | null;
};

export type SupportRequestEvent = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type SupportRequestDetail = SupportRequestListItem & {
  message: string;
  source: string;
  internal_notes: string | null;
  assigned_to_email: string | null;
  attachments: SupportRequestAttachment[];
  events: SupportRequestEvent[];
};

type SuperOpsAction =
  | "get_control_center"
  | "set_runtime_config"
  | "upsert_alert_rule"
  | "set_tenant_policy"
  | "set_tenant_force_reauth"
  | "create_approval"
  | "approve_request"
  | "list_support_requests"
  | "get_support_request"
  | "update_support_request"
  | "list_sales_leads"
  | "set_sales_lead_stage"
  | "delete_sales_lead"
  | "close_sales_lead"
  | "move_sales_lead_to_customer"
  | "list_customers"
  | "add_customer_status_entry"
  | "get_internal_ops_snapshot";

type SuperOpsRequest = {
  action: SuperOpsAction;
  payload: Record<string, unknown>;
};

const callSuperOps = async <TData>(payload: SuperOpsRequest) => {
  const result = await invokeEdgeFunction<{ data?: TData }, SuperOpsRequest>(
    "super-ops",
    {
      method: "POST",
      body: payload,
    }
  );

  if (!result.ok) {
    throw edgeFunctionError(result, "Super ops request failed.");
  }

  return result.data?.data as TData;
};

export type SuperControlCenter = {
  runtime_config: RuntimeConfigMap;
  alert_rules: SuperAlertRule[];
  approvals: SuperApproval[];
  jobs: SuperJob[];
};

export const getControlCenter = async () =>
  callSuperOps<SuperControlCenter>({
    action: "get_control_center",
    payload: {},
  });

export const setRuntimeConfig = async (payload: {
  key: string;
  value: Record<string, unknown>;
}) =>
  callSuperOps<{ key: string; value: Record<string, unknown> }>({
    action: "set_runtime_config",
    payload,
  });

export const upsertAlertRule = async (payload: {
  id?: string;
  name: string;
  metric_key: string;
  threshold: number;
  is_enabled: boolean;
}) =>
  callSuperOps<SuperAlertRule>({
    action: "upsert_alert_rule",
    payload,
  });

export const forceTenantReauth = async (payload: { tenant_id: string }) =>
  callSuperOps<{ success: boolean; job: SuperJob | null }>({
    action: "set_tenant_force_reauth",
    payload,
  });

export const setTenantPolicy = async (payload: {
  tenant_id: string;
  checkout_due_hours: number;
  feature_flags: {
    enable_notifications: boolean;
    enable_bulk_item_import: boolean;
    enable_bulk_student_tools: boolean;
    enable_status_tracking: boolean;
    enable_barcode_generator: boolean;
  };
}) =>
  callSuperOps<{
    tenant_id: string;
    checkout_due_hours: number;
    feature_flags: Record<string, unknown>;
  }>({
    action: "set_tenant_policy",
    payload,
  });

export const approveRequest = async (payload: { id: string }) =>
  callSuperOps<SuperApproval>({
    action: "approve_request",
    payload,
  });

export const listSupportRequests = async (payload: {
  search?: string;
  status?: SupportRequestStatus | "";
  limit?: number;
} = {}) =>
  callSuperOps<{ requests: SupportRequestListItem[] }>({
    action: "list_support_requests",
    payload,
  });

export const getSupportRequest = async (payload: { support_request_id: string }) =>
  callSuperOps<{ request: SupportRequestDetail }>({
    action: "get_support_request",
    payload,
  });

export const updateSupportRequest = async (payload: {
  support_request_id: string;
  status?: SupportRequestStatus;
  internal_notes?: string;
  assign_to_me?: boolean;
  clear_assignment?: boolean;
}) =>
  callSuperOps<{ request: SupportRequestDetail }>({
    action: "update_support_request",
    payload,
  });

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

export const deleteSalesLead = async (payload: { lead_id: string }) =>
  callSuperOps<{ deleted: boolean }>({
    action: "delete_sales_lead",
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

export const getInternalOpsSnapshot = async () =>
  callSuperOps<InternalOpsSnapshot>({
    action: "get_internal_ops_snapshot",
    payload: {},
  });
