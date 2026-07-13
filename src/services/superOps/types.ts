type RuntimeConfigMap = Record<string, unknown>;

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

type InternalOpsEvent = {
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

type SupportRequestAttachment = {
  id: string;
  original_filename: string | null;
  stored_filename: string;
  content_type: string;
  size_bytes: number;
  signed_url: string | null;
};

type SupportRequestEvent = {
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

export type SuperControlCenter = {
  runtime_config: RuntimeConfigMap;
  alert_rules: SuperAlertRule[];
  approvals: SuperApproval[];
  jobs: SuperJob[];
};

export type SuperAdminSessionItem = {
  id: string;
  device_id: string;
  device_label: string | null;
  user_agent: string | null;
  login_method: "password" | "passkey" | null;
  login_location: "super_auth" | "super_settings" | null;
  general_location: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  is_current: boolean;
};
