import { z } from "zod";

const tenantFeatureFlagsSchema = z.object({
  enable_notifications: z.boolean(),
  enable_bulk_item_import: z.boolean(),
  enable_bulk_student_tools: z.boolean(),
  enable_status_tracking: z.boolean(),
  enable_barcode_generator: z.boolean(),
});

const edgeEnvelopeSchema = (dataSchema) =>
  z.object({
    data: dataSchema.optional(),
  });

const tenantStatusSchema = z.enum(["active", "suspended", "archived"]);
const accountCategorySchema = z.enum(["organization", "district", "individual"]);
const tenantPlanCodeSchema = z.enum([
  "core",
  "growth",
  "starter",
  "scale",
  "enterprise",
  "individual_yearly",
  "individual_monthly",
]);
const districtSubscriptionPlanSchema = z.enum([
  "district_core",
  "district_growth",
  "district_enterprise",
  "organization_starter",
  "organization_scale",
  "organization_enterprise",
]);
const districtBillingStatusSchema = z.enum(["draft", "active", "past_due", "canceled"]);
const tenantAdminLoginMethodSchema = z.enum(["password", "magic_link", "session_handoff"]);
const tenantAdminLoginLocationSchema = z.enum(["regular_login", "admin_login"]);

const adminOpsDevicePayloadSchema = z.object({
  device_id: z.string().min(1),
  device_label: z.string().min(1),
  login_method: tenantAdminLoginMethodSchema.optional(),
  login_location: tenantAdminLoginLocationSchema.optional(),
});

const tenantSettingsSchema = z.object({
  checkout_due_hours: z.number().int().nonnegative(),
  account_category: accountCategorySchema.nullable(),
  plan_code: tenantPlanCodeSchema.nullable(),
  feature_flags: tenantFeatureFlagsSchema,
});

const tenantNotificationSchema = z.object({
  overdue_count: z.number().int().nonnegative(),
  flagged_count: z.number().int().nonnegative(),
  checkout_due_hours: z.number().int().nonnegative(),
  updates: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      message: z.string(),
      level: z.enum(["info", "warning", "critical"]),
      created_at: z.string(),
      link_url: z.string().nullable(),
    })
  ),
  feature_flags: tenantFeatureFlagsSchema,
  maintenance: z
    .object({
      enabled: z.boolean(),
      message: z.string(),
    })
    .nullable(),
  recent_status_events: z.array(
    z.object({
      id: z.string(),
      gear_id: z.string(),
      status: z.string(),
      note: z.string().nullable(),
      changed_at: z.string(),
      changed_by: z.string().nullable(),
      gear: z
        .object({
          name: z.string(),
          barcode: z.string(),
        })
        .nullable(),
    })
  ),
});

const statusTrackedItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  barcode: z.string(),
  serial_number: z.string().nullable(),
  status: z.string(),
  notes: z.string().nullable(),
  updated_at: z.string(),
});

const tenantSessionSchema = z.object({
  id: z.string(),
  device_id: z.string(),
  device_label: z.string().nullable(),
  user_agent: z.string().nullable(),
  login_method: tenantAdminLoginMethodSchema.nullable(),
  login_location: tenantAdminLoginLocationSchema.nullable(),
  general_location: z.string().nullable(),
  created_at: z.string(),
  last_seen_at: z.string(),
  is_current: z.boolean(),
});

const adminOpsRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_notifications"), payload: adminOpsDevicePayloadSchema }),
  z.object({
    action: z.literal("get_status_tracking"),
    payload: adminOpsDevicePayloadSchema,
  }),
  z.object({
    action: z.literal("bulk_import_gear"),
    payload: adminOpsDevicePayloadSchema.extend({
      rows: z.array(
        z.object({
          name: z.string().min(1),
          barcode: z.string().min(1),
          serial_number: z.string().optional(),
          status: z.string().optional(),
          notes: z.string().optional(),
        })
      ),
    }),
  }),
  z.object({ action: z.literal("get_tenant_settings"), payload: adminOpsDevicePayloadSchema }),
  z.object({
    action: z.literal("update_tenant_settings"),
    payload: adminOpsDevicePayloadSchema.extend({
      checkout_due_hours: z.number().int().nonnegative(),
    }),
  }),
  z.object({ action: z.literal("touch_session"), payload: adminOpsDevicePayloadSchema }),
  z.object({ action: z.literal("validate_session"), payload: adminOpsDevicePayloadSchema }),
  z.object({ action: z.literal("list_sessions"), payload: adminOpsDevicePayloadSchema }),
  z.object({
    action: z.literal("revoke_current_session"),
    payload: adminOpsDevicePayloadSchema,
  }),
  z.object({
    action: z.literal("revoke_session"),
    payload: adminOpsDevicePayloadSchema.extend({
      session_id: z.string().min(1),
    }),
  }),
  z.object({
    action: z.literal("revoke_all_sessions"),
    payload: adminOpsDevicePayloadSchema.extend({
      sign_out_current: z.boolean(),
    }),
  }),
]);

const adminOpsResponseSchemas = {
  get_notifications: edgeEnvelopeSchema(tenantNotificationSchema),
  get_status_tracking: edgeEnvelopeSchema(
    z.object({
      flagged_items: z.array(statusTrackedItemSchema),
      history: tenantNotificationSchema.shape.recent_status_events,
    })
  ),
  bulk_import_gear: edgeEnvelopeSchema(
    z.object({
      inserted: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      inserted_items: z.array(statusTrackedItemSchema),
      skipped_rows: z.array(
        z.object({
          barcode: z.string(),
          reason: z.string(),
        })
      ),
    })
  ),
  get_tenant_settings: edgeEnvelopeSchema(tenantSettingsSchema),
  update_tenant_settings: edgeEnvelopeSchema(tenantSettingsSchema),
  touch_session: edgeEnvelopeSchema(z.object({ ok: z.boolean() })),
  validate_session: edgeEnvelopeSchema(z.object({ valid: z.boolean() })),
  list_sessions: edgeEnvelopeSchema(z.object({ sessions: z.array(tenantSessionSchema) })),
  revoke_current_session: edgeEnvelopeSchema(z.object({ revoked: z.boolean() })),
  revoke_session: edgeEnvelopeSchema(z.object({ revoked: z.boolean() })),
  revoke_all_sessions: edgeEnvelopeSchema(z.object({ revoked: z.number().int().nonnegative() })),
};

const superTenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  access_code: z.string(),
  status: tenantStatusSchema,
  created_at: z.string(),
  district_id: z.string().nullable().optional(),
  district_name: z.string().nullable().optional(),
  district_slug: z.string().nullable().optional(),
  primary_admin_profile_id: z.string().nullable().optional(),
  primary_admin_email: z.string().nullable().optional(),
  checkout_due_hours: z.number().int().nonnegative().optional(),
  account_category: accountCategorySchema.optional(),
  plan_code: tenantPlanCodeSchema.nullable().optional(),
  feature_flags: tenantFeatureFlagsSchema.partial().optional(),
});

const superDistrictSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  support_email: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string(),
  tenants_count: z.number().int().nonnegative().optional(),
  subscription_plan: districtSubscriptionPlanSchema.nullable().optional(),
  billing_status: districtBillingStatusSchema.nullable().optional(),
  renewal_date: z.string().nullable().optional(),
  billing_email: z.string().nullable().optional(),
  invoice_reference: z.string().nullable().optional(),
});

const superDistrictDetailSchema = z.object({
  district: superDistrictSchema,
  tenants: z.array(superTenantSchema),
  support_requests: z.array(
    z.object({
      id: z.string(),
      requester_email: z.string().nullable().optional(),
      requester_name: z.string().nullable().optional(),
      subject: z.string(),
      message: z.string(),
      priority: z.enum(["low", "normal", "high", "urgent"]),
      status: z.enum(["open", "in_progress", "resolved"]),
      created_at: z.string(),
    })
  ),
  tenant_metrics: z.array(
    z.object({
      tenant_id: z.string(),
      tenant_name: z.string(),
      gear_total: z.number().int().nonnegative(),
      students_total: z.number().int().nonnegative(),
      active_checkouts: z.number().int().nonnegative(),
      overdue_items: z.number().int().nonnegative(),
      transactions_7d: z.number().int().nonnegative(),
    })
  ),
  traffic: z.object({
    checkout_24h: z.number().int().nonnegative(),
    return_24h: z.number().int().nonnegative(),
    active_tenants_24h: z.number().int().nonnegative(),
    events_24h: z.number().int().nonnegative(),
  }),
  traffic_by_hour: z.array(
    z.object({ hour: z.string(), checkout: z.number().int().nonnegative(), return: z.number().int().nonnegative() })
  ),
  recent_events: z.array(
    z.object({
      tenant_id: z.string().nullable(),
      tenant_name: z.string(),
      action_type: z.enum(["checkout", "return"]),
      action_time: z.string(),
      gear_name: z.string().nullable(),
      gear_barcode: z.string().nullable(),
      student_username: z.string().nullable(),
      student_id: z.string().nullable(),
    })
  ),
  needs_attention: z.array(
    z.object({
      key: z.string(),
      level: z.enum(["high", "medium", "low"]),
      title: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
  usage: z.object({
    gear_total: z.number().int().nonnegative(),
    students_total: z.number().int().nonnegative(),
    active_checkouts: z.number().int().nonnegative(),
    overdue_items: z.number().int().nonnegative(),
    transactions_7d: z.number().int().nonnegative(),
  }),
});

const superTenantRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_tenants"), payload: z.object({ search: z.string(), status: z.string() }) }),
  z.object({
    action: z.literal("create_tenant"),
    payload: z.object({
      name: z.string().min(1),
      access_code: z.string().min(1),
      auth_email: z.string().email(),
      password: z.string().min(8),
      status: tenantStatusSchema,
      account_category: accountCategorySchema.optional(),
      plan_code: tenantPlanCodeSchema.optional(),
      district_name: z.string().optional(),
      district_slug: z.string().optional(),
    }),
  }),
  z.object({
    action: z.literal("update_tenant"),
    payload: z.object({
      id: z.string().uuid(),
      name: z.string().min(1),
      access_code: z.string().min(1),
      account_category: accountCategorySchema.optional(),
      plan_code: tenantPlanCodeSchema.optional(),
      district_name: z.string().optional(),
      district_slug: z.string().optional(),
    }),
  }),
  z.object({
    action: z.literal("set_tenant_status"),
    payload: z.object({
      id: z.string().uuid(),
      status: tenantStatusSchema,
      super_password: z.string().min(1),
      confirm_phrase: z.string().min(1),
    }),
  }),
  z.object({ action: z.literal("send_primary_admin_reset"), payload: z.object({ tenant_id: z.string().uuid() }) }),
  z.object({ action: z.literal("set_primary_admin"), payload: z.object({ tenant_id: z.string().uuid(), profile_id: z.string().uuid() }) }),
  z.object({ action: z.literal("list_districts"), payload: z.object({ search: z.string() }) }),
  z.object({
    action: z.literal("create_district"),
    payload: z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
      support_email: z.string().email().optional(),
      contact_name: z.string().optional(),
      subscription_plan: districtSubscriptionPlanSchema.optional(),
      billing_status: districtBillingStatusSchema.optional(),
      renewal_date: z.string().optional(),
      billing_email: z.string().email().optional(),
      invoice_reference: z.string().optional(),
    }),
  }),
  z.object({
    action: z.literal("update_district"),
    payload: z.object({
      id: z.string().uuid(),
      name: z.string().min(1),
      slug: z.string().min(1),
      support_email: z.string().email().optional(),
      contact_name: z.string().optional(),
      is_active: z.boolean(),
      subscription_plan: districtSubscriptionPlanSchema.optional(),
      billing_status: districtBillingStatusSchema.optional(),
      renewal_date: z.string().optional(),
      billing_email: z.string().email().optional(),
      invoice_reference: z.string().optional(),
    }),
  }),
  z.object({ action: z.literal("get_district_details"), payload: z.object({ id: z.string().uuid() }) }),
]);

const superTenantResponseSchemas = {
  list_tenants: edgeEnvelopeSchema(z.array(superTenantSchema)),
  create_tenant: edgeEnvelopeSchema(superTenantSchema),
  update_tenant: edgeEnvelopeSchema(superTenantSchema),
  set_tenant_status: edgeEnvelopeSchema(superTenantSchema),
  send_primary_admin_reset: edgeEnvelopeSchema(z.object({ success: z.boolean(), auth_email: z.string().email() })),
  set_primary_admin: edgeEnvelopeSchema(superTenantSchema),
  list_districts: edgeEnvelopeSchema(z.array(superDistrictSchema)),
  create_district: edgeEnvelopeSchema(superDistrictSchema),
  update_district: edgeEnvelopeSchema(superDistrictSchema),
  get_district_details: edgeEnvelopeSchema(superDistrictDetailSchema),
};

const tenantManagedAdminSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  auth_email: z.string().email(),
  role: z.literal("tenant_admin"),
  is_active: z.boolean(),
  created_at: z.string(),
  is_primary_admin: z.boolean(),
});

const tenantAdminManageRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_tenant_admins"), payload: z.object({}) }),
  z.object({ action: z.literal("create_tenant_admin"), payload: z.object({ auth_email: z.string().email() }) }),
  z.object({ action: z.literal("set_admin_status"), payload: z.object({ id: z.string().uuid(), is_active: z.boolean() }) }),
  z.object({ action: z.literal("update_admin_email"), payload: z.object({ id: z.string().uuid(), auth_email: z.string().email() }) }),
  z.object({ action: z.literal("send_tenant_admin_reset"), payload: z.object({ auth_email: z.string().email() }) }),
]);

const tenantAdminManageResponseSchemas = {
  list_tenant_admins: edgeEnvelopeSchema(
    z.object({
      admins: z.array(tenantManagedAdminSchema),
      can_manage_admins: z.boolean(),
      primary_admin_profile_id: z.string().uuid().nullable(),
    })
  ),
  create_tenant_admin: edgeEnvelopeSchema(z.object({ success: z.boolean(), auth_email: z.string().email(), message: z.string().optional() })),
  set_admin_status: edgeEnvelopeSchema(tenantManagedAdminSchema),
  update_admin_email: edgeEnvelopeSchema(tenantManagedAdminSchema),
  send_tenant_admin_reset: edgeEnvelopeSchema(z.object({ success: z.boolean() })),
};


const superOpsJobSchema = z.object({
  id: z.string(),
  job_type: z.string(),
  status: z.string(),
  details: z.record(z.string(), z.unknown()).or(z.object({}).passthrough()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const superOpsApprovalSchema = z.object({
  id: z.string(),
  action_type: z.string(),
  payload: z.record(z.string(), z.unknown()).or(z.object({}).passthrough()),
  requested_by: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  status: z.string(),
  created_at: z.string(),
  decided_at: z.string().nullable().optional(),
});

const superOpsAlertRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  metric_key: z.string(),
  threshold: z.number(),
  is_enabled: z.boolean(),
  created_at: z.string(),
});

const superOpsTenantPolicySchema = z.object({
  tenant_id: z.string(),
  max_admins: z.number().int().nullable().optional(),
  max_students: z.number().int().nullable().optional(),
  max_gear: z.number().int().nullable().optional(),
  checkout_due_hours: z.number().int().nonnegative(),
  barcode_pattern: z.string().nullable().optional(),
  feature_flags: z.record(z.string(), z.unknown()).optional(),
});

const salesLeadSchema = z.object({
  id: z.string(),
  plan: z.string(),
  lead_state: z.string(),
  stage: z.string().nullable().optional(),
  schools_count: z.number().int().nullable().optional(),
  name: z.string().nullable().optional(),
  organization: z.string().nullable().optional(),
  reply_email: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const customerStatusLogSchema = z.object({
  id: z.string(),
  lead_id: z.string(),
  invoice_id: z.string(),
  status: z.string(),
  created_at: z.string(),
  created_by: z.string().nullable().optional(),
});

const customerSchema = salesLeadSchema.extend({
  latest_status: z.string().nullable().optional(),
  latest_invoice_id: z.string().nullable().optional(),
  status_logs: z.array(customerStatusLogSchema),
});

const superOpsLoginMethodSchema = z.enum(["password", "passkey"]);
const superOpsLoginLocationSchema = z.enum(["super_auth", "super_settings"]);

const superOpsDevicePayloadSchema = z.object({
  device_id: z.string().min(1).optional(),
  device_label: z.string().nullable().optional(),
  login_method: superOpsLoginMethodSchema.nullable().optional(),
  login_location: superOpsLoginLocationSchema.nullable().optional(),
});

const superOpsSessionSchema = z.object({
  id: z.string(),
  device_id: z.string(),
  device_label: z.string().nullable(),
  user_agent: z.string().nullable(),
  login_method: superOpsLoginMethodSchema.nullable(),
  login_location: superOpsLoginLocationSchema.nullable(),
  general_location: z.string().nullable(),
  created_at: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  is_current: z.boolean(),
});

const supportRequestStatusSchema = z.enum(["open", "in_progress", "resolved", "spam"]);
const supportRequestCategorySchema = z.enum(["general", "bug", "billing", "access", "feature", "privacy", "other"]);

const supportRequestListItemSchema = z.object({
  id: z.string(),
  requester_name: z.string(),
  reply_email: z.string(),
  subject: z.string(),
  category: supportRequestCategorySchema,
  status: supportRequestStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  assigned_to: z.string().nullable(),
});

const supportRequestDetailSchema = supportRequestListItemSchema.extend({
  message: z.string(),
  source: z.string(),
  internal_notes: z.string().nullable(),
  assigned_to_email: z.string().nullable(),
  attachments: z.array(z.object({
    id: z.string(),
    original_filename: z.string().nullable(),
    stored_filename: z.string(),
    content_type: z.string(),
    size_bytes: z.number().int().nonnegative(),
    signed_url: z.string().nullable(),
  })),
  events: z.array(z.object({
    id: z.string(),
    actor_id: z.string().nullable(),
    actor_email: z.string().nullable(),
    event_type: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    created_at: z.string(),
  })),
});

const subprocessorChangeTypeSchema = z.enum(["added", "replaced", "removed"]);
const subprocessorNoticePayloadSchema = z.object({
  vendor: z.string().min(1),
  change_type: subprocessorChangeTypeSchema,
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().optional(),
});

const subprocessorNoticeSchema = z.object({
  id: z.string(),
  vendor: z.string(),
  change_type: subprocessorChangeTypeSchema,
  effective_date: z.string(),
  description: z.string().nullable(),
  notice_sent_at: z.string().nullable(),
  objection_deadline: z.string().nullable(),
  recipients_count: z.number().int().nonnegative(),
  status: z.enum(["pending", "sent", "failed"]),
  created_by_email: z.string().nullable(),
  created_at: z.string(),
});

const internalOpsSnapshotSchema = z.object({
  checked_at: z.string(),
  traffic: z.object({
    checkout_15m: z.number().int().nonnegative(),
    return_15m: z.number().int().nonnegative(),
    active_tenants_15m: z.number().int().nonnegative(),
    events_24h: z.number().int().nonnegative(),
  }),
  queue: z.object({
    queued: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  leads: z.object({
    open: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
    converted: z.number().int().nonnegative(),
    waiting_for_quote: z.number().int().nonnegative(),
    quote_sent: z.number().int().nonnegative(),
    invoice_sent: z.number().int().nonnegative(),
    invoice_paid: z.number().int().nonnegative(),
  }),
  lead_funnel: z.object({
    waiting_for_quote: z.number().int().nonnegative(),
    quote_generated: z.number().int().nonnegative(),
    quote_sent: z.number().int().nonnegative(),
    quote_converted_to_invoice: z.number().int().nonnegative(),
    invoice_sent: z.number().int().nonnegative(),
    invoice_paid: z.number().int().nonnegative(),
  }),
  traffic_by_hour: z.array(z.object({
    hour: z.string(),
    checkout: z.number().int().nonnegative(),
    return: z.number().int().nonnegative(),
  })),
  sla: z.object({
    median_latency_ms: z.number().nullable(),
    p95_latency_ms: z.number().nullable(),
    error_rate_percent: z.number().nonnegative(),
    probe_latency_ms: z.number().nullable(),
  }),
  needs_attention: z.array(z.object({
    key: z.string(),
    level: z.enum(["high", "medium", "low"]),
    title: z.string(),
    count: z.number().int().nonnegative(),
    route: z.string(),
  })),
  customer_health: z.object({
    total_customers: z.number().int().nonnegative(),
    awaiting_payment: z.number().int().nonnegative(),
    canceling: z.number().int().nonnegative(),
    paid_late: z.number().int().nonnegative(),
    paid_on_time: z.number().int().nonnegative(),
    no_status: z.number().int().nonnegative(),
  }),
  recent_audit: z.array(z.object({
    id: z.string(),
    actor_email: z.string().nullable(),
    action_type: z.string(),
    target_type: z.string().nullable(),
    target_id: z.string().nullable(),
    created_at: z.string(),
  })),
  search_index: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(["page", "tenant", "customer", "lead"]),
    route: z.string(),
  })),
  runtime: z.record(z.string(), z.unknown()),
  recent_events: z.array(z.object({
    tenant_id: z.string().nullable(),
    tenant_name: z.string(),
    action_type: z.enum(["checkout", "return"]),
    action_time: z.string(),
    gear_name: z.string().nullable(),
    gear_barcode: z.string().nullable(),
    student_username: z.string().nullable(),
    student_id: z.string().nullable(),
  })),
});

const superOpsRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify_password"), payload: z.object({ password: z.string().min(1) }) }),
  z.object({
    action: z.literal("touch_session"),
    payload: superOpsDevicePayloadSchema.extend({ device_id: z.string().min(1) }),
  }),
  z.object({ action: z.literal("list_sessions"), payload: superOpsDevicePayloadSchema }),
  z.object({
    action: z.literal("revoke_session"),
    payload: superOpsDevicePayloadSchema.extend({ session_id: z.string().min(1) }),
  }),
  z.object({
    action: z.literal("revoke_all_sessions"),
    payload: superOpsDevicePayloadSchema.extend({ sign_out_current: z.boolean().optional() }),
  }),
  z.object({ action: z.literal("get_control_center"), payload: z.object({}).optional() }),
  z.object({ action: z.literal("set_runtime_config"), payload: z.object({ key: z.string().min(1), value: z.unknown() }) }),
  z.object({ action: z.literal("upsert_alert_rule"), payload: z.object({ id: z.string().optional(), name: z.string().min(1), metric_key: z.string().min(1), threshold: z.number(), is_enabled: z.boolean().optional() }) }),
  z.object({ action: z.literal("set_tenant_policy"), payload: z.object({ tenant_id: z.string().min(1), max_admins: z.number().int().nullable().optional(), max_students: z.number().int().nullable().optional(), max_gear: z.number().int().nullable().optional(), checkout_due_hours: z.number().int().nullable().optional(), barcode_pattern: z.string().nullable().optional(), feature_flags: z.record(z.string(), z.unknown()).optional() }) }),
  z.object({ action: z.literal("set_tenant_force_reauth"), payload: z.object({ tenant_id: z.string().min(1) }) }),
  z.object({ action: z.literal("create_approval"), payload: z.object({ action_type: z.string().min(1), payload: z.record(z.string(), z.unknown()).or(z.object({}).passthrough()) }) }),
  z.object({ action: z.literal("approve_request"), payload: z.object({ id: z.string().min(1) }) }),
  z.object({
    action: z.literal("list_support_requests"),
    payload: z.object({
      search: z.string().optional(),
      status: supportRequestStatusSchema.or(z.literal("")).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).optional(),
  }),
  z.object({
    action: z.literal("get_support_request"),
    payload: z.object({ support_request_id: z.string().uuid() }),
  }),
  z.object({
    action: z.literal("update_support_request"),
    payload: z.object({
      support_request_id: z.string().uuid(),
      status: supportRequestStatusSchema.optional(),
      internal_notes: z.string().optional(),
      assign_to_me: z.boolean().optional(),
      clear_assignment: z.boolean().optional(),
    }),
  }),
  z.object({ action: z.literal("list_sales_leads"), payload: z.object({ search: z.string().optional(), limit: z.number().int().optional() }).optional() }),
  z.object({ action: z.literal("close_sales_lead"), payload: z.object({ lead_id: z.string().min(1) }) }),
  z.object({ action: z.literal("move_sales_lead_to_customer"), payload: z.object({ lead_id: z.string().min(1) }) }),
  z.object({ action: z.literal("set_sales_lead_stage"), payload: z.object({ lead_id: z.string().min(1), stage: z.enum(["waiting_for_quote","quote_generated","quote_sent","quote_converted_to_invoice","invoice_sent","invoice_paid"]) }) }),
  z.object({ action: z.literal("delete_sales_lead"), payload: z.object({ lead_id: z.string().min(1) }) }),
  z.object({ action: z.literal("list_customers"), payload: z.object({ search: z.string().optional(), limit: z.number().int().optional() }).optional() }),
  z.object({ action: z.literal("add_customer_status_entry"), payload: z.object({ lead_id: z.string().min(1), invoice_id: z.string().min(1), status: z.enum(["paid_on_time","paid_late","awaiting_payment","canceling"]) }) }),
  z.object({ action: z.literal("get_internal_ops_snapshot"), payload: z.object({}).optional() }),
  z.object({ action: z.literal("preview_subprocessor_notice"), payload: subprocessorNoticePayloadSchema }),
  z.object({ action: z.literal("announce_subprocessor_change"), payload: subprocessorNoticePayloadSchema }),
  z.object({ action: z.literal("list_subprocessor_notices"), payload: z.object({}).optional() }),
]);

const superOpsResponseSchemas = {
  verify_password: edgeEnvelopeSchema(z.object({ verified: z.boolean() })),
  touch_session: edgeEnvelopeSchema(z.object({ ok: z.boolean() })),
  list_sessions: edgeEnvelopeSchema(z.object({ sessions: z.array(superOpsSessionSchema) })),
  revoke_session: edgeEnvelopeSchema(z.object({ revoked: z.boolean() })),
  revoke_all_sessions: edgeEnvelopeSchema(z.object({ revoked: z.number().int().nonnegative() })),
  get_control_center: edgeEnvelopeSchema(z.object({
    runtime_config: z.record(z.string(), z.unknown()),
    alert_rules: z.array(superOpsAlertRuleSchema),
    approvals: z.array(superOpsApprovalSchema),
    jobs: z.array(superOpsJobSchema),
  })),
  set_runtime_config: edgeEnvelopeSchema(z.object({ key: z.string(), value: z.unknown() })),
  upsert_alert_rule: edgeEnvelopeSchema(superOpsAlertRuleSchema),
  set_tenant_policy: edgeEnvelopeSchema(superOpsTenantPolicySchema),
  set_tenant_force_reauth: edgeEnvelopeSchema(z.object({ success: z.boolean(), job: superOpsJobSchema.nullable().optional() })),
  create_approval: edgeEnvelopeSchema(z.object({ id: z.string(), action_type: z.string(), payload: z.record(z.string(), z.unknown()).or(z.object({}).passthrough()), requested_by: z.string().nullable().optional(), status: z.string(), created_at: z.string() })),
  approve_request: edgeEnvelopeSchema(superOpsApprovalSchema),
  list_support_requests: edgeEnvelopeSchema(z.object({ requests: z.array(supportRequestListItemSchema) })),
  get_support_request: edgeEnvelopeSchema(z.object({ request: supportRequestDetailSchema })),
  update_support_request: edgeEnvelopeSchema(z.object({ request: supportRequestDetailSchema })),
  list_sales_leads: edgeEnvelopeSchema(z.object({ leads: z.array(salesLeadSchema) })),
  close_sales_lead: edgeEnvelopeSchema(z.object({ lead: salesLeadSchema })),
  move_sales_lead_to_customer: edgeEnvelopeSchema(z.object({ lead: salesLeadSchema })),
  set_sales_lead_stage: edgeEnvelopeSchema(z.object({ lead: salesLeadSchema })),
  delete_sales_lead: edgeEnvelopeSchema(z.object({ deleted: z.boolean() })),
  list_customers: edgeEnvelopeSchema(z.object({ customers: z.array(customerSchema) })),
  add_customer_status_entry: edgeEnvelopeSchema(z.object({ entry: customerStatusLogSchema })),
  get_internal_ops_snapshot: edgeEnvelopeSchema(internalOpsSnapshotSchema),
  preview_subprocessor_notice: z.object({
    preview: z.object({
      subject: z.string(),
      html: z.string(),
      text: z.string(),
      targetCount: z.number().int().nonnegative(),
      objectionDeadline: z.string(),
    }),
  }),
  announce_subprocessor_change: z.object({
    changeId: z.string(),
    vendor: z.string(),
    changeType: subprocessorChangeTypeSchema,
    effectiveDate: z.string(),
    objectionDeadline: z.string(),
    noticeSentAt: z.string(),
    recipientsCount: z.number().int().nonnegative(),
    totalTargets: z.number().int().nonnegative(),
  }),
  list_subprocessor_notices: z.object({ notices: z.array(subprocessorNoticeSchema) }),
};

const superTenantAdminSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string(),
  district_id: z.string().optional(),
  auth_email: z.string().email(),
  role: z.enum(["tenant_admin", "district_admin"]),
  is_active: z.boolean(),
  created_at: z.string(),
  tenant_name: z.string().nullable().optional(),
  district_name: z.string().nullable().optional(),
});

const superAdminRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list_tenant_admins"),
    payload: z.object({
      search: z.string(),
      tenant_id: z.string(),
      district_id: z.string(),
      admin_scope: z.enum(["tenant", "district"]),
    }),
  }),
  z.object({
    action: z.literal("create_tenant_admin"),
    payload: z.object({
      tenant_id: z.string().optional(),
      district_id: z.string().optional(),
      auth_email: z.string().email(),
      password: z.string().min(8),
      admin_scope: z.enum(["tenant", "district"]).optional(),
    }),
  }),
  z.object({
    action: z.literal("set_admin_status"),
    payload: z.object({
      id: z.string().uuid(),
      is_active: z.boolean(),
      admin_scope: z.enum(["tenant", "district"]).optional(),
    }),
  }),
  z.object({
    action: z.literal("update_admin_email"),
    payload: z.object({
      id: z.string().uuid(),
      auth_email: z.string().email(),
      admin_scope: z.enum(["tenant", "district"]).optional(),
    }),
  }),
  z.object({
    action: z.literal("send_reset"),
    payload: z.object({
      auth_email: z.string().email(),
      admin_scope: z.enum(["tenant", "district"]).optional(),
    }),
  }),
]);

const superAdminResponseSchemas = {
  list_tenant_admins: edgeEnvelopeSchema(z.array(superTenantAdminSchema)),
  create_tenant_admin: edgeEnvelopeSchema(superTenantAdminSchema),
  set_admin_status: edgeEnvelopeSchema(superTenantAdminSchema),
  update_admin_email: edgeEnvelopeSchema(superTenantAdminSchema),
  send_reset: edgeEnvelopeSchema(z.object({ success: z.boolean() })),
};


const districtDashboardDistrictSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  support_email: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  is_active: z.boolean(),
  subscription_plan: districtSubscriptionPlanSchema.nullable().optional(),
  billing_status: districtBillingStatusSchema.nullable().optional(),
  renewal_date: z.string().nullable().optional(),
  billing_email: z.string().nullable().optional(),
  invoice_reference: z.string().nullable().optional(),
});

const districtDashboardTenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  access_code: z.string(),
  status: tenantStatusSchema,
  created_at: z.string(),
  primary_admin_profile_id: z.string().nullable().optional(),
  primary_admin_email: z.string().nullable().optional(),
});

const districtDashboardResponseSchema = z.object({
  data: z.object({
    district: districtDashboardDistrictSchema,
    support_requests: z.array(z.object({
      id: z.string(), requester_email: z.string().nullable().optional(), requester_name: z.string().nullable().optional(), subject: z.string(), message: z.string(), priority: z.enum(["low","normal","high","urgent"]), status: z.enum(["open","in_progress","resolved"]), created_at: z.string()
    })),
    tenant_metrics: z.array(z.object({
      tenant_id: z.string(), tenant_name: z.string(), gear_total: z.number().int().nonnegative(), students_total: z.number().int().nonnegative(), active_checkouts: z.number().int().nonnegative(), overdue_items: z.number().int().nonnegative(), transactions_7d: z.number().int().nonnegative()
    })),
    traffic: z.object({ checkout_24h: z.number().int().nonnegative(), return_24h: z.number().int().nonnegative(), active_tenants_24h: z.number().int().nonnegative(), events_24h: z.number().int().nonnegative() }),
    traffic_by_hour: z.array(z.object({ hour: z.string(), checkout: z.number().int().nonnegative(), return: z.number().int().nonnegative() })),
    recent_events: z.array(z.object({ tenant_id: z.string().nullable(), tenant_name: z.string(), action_type: z.enum(["checkout","return"]), action_time: z.string(), gear_name: z.string().nullable(), gear_barcode: z.string().nullable(), student_username: z.string().nullable(), student_id: z.string().nullable() })),
    needs_attention: z.array(z.object({ key: z.string(), level: z.enum(["high","medium","low"]), title: z.string(), count: z.number().int().nonnegative() })),
    tenants: z.array(districtDashboardTenantSchema),
    usage: z.object({ gear_total: z.number().int().nonnegative(), students_total: z.number().int().nonnegative(), active_checkouts: z.number().int().nonnegative(), overdue_items: z.number().int().nonnegative(), transactions_7d: z.number().int().nonnegative() })
  })
});

const districtHandoffRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), auth_email: z.string().email(), password: z.string().min(1), district_slug: z.string().min(1) }),
  z.object({ action: z.literal("create_admin"), email: z.string().email(), password: z.string().min(1) }),
  z.object({ action: z.literal("consume"), code: z.string().min(1) }),
]);

const districtHandoffResponseSchemas = {
  create: z.object({ code: z.string(), expires_at: z.string() }),
  create_admin: z.object({ code: z.string().nullable(), district_slug: z.string().nullable(), role: z.enum(["tenant_admin","district_admin"]), expires_at: z.string().optional(), root_only: z.boolean().optional() }),
  consume: z.object({ access_token: z.string(), refresh_token: z.string(), district_slug: z.string() }),
};

const contactSalesPlanSchema = z.enum(["district_core","district_growth","district_enterprise","organization_starter","organization_scale","organization_enterprise","individual_yearly","individual_monthly","other"]);
const contactSalesIntentSchema = z.enum(["sales","demo"]);

const contactSalesSubmitRequestSchema = z.object({
  plan: contactSalesPlanSchema,
  schools_count: z.number().int().positive().nullable().optional(),
  name: z.string().min(1),
  organization: z.string().optional(),
  reply_email: z.string().email(),
  details: z.string().optional(),
  turnstile_token: z.string().min(1),
  website: z.string().optional(),
  intent: contactSalesIntentSchema.optional(),
});

const contactSalesSubmitResponseSchema = z.object({
  ok: z.boolean(),
  data: z.object({ lead_id: z.string() }).optional(),
  error: z.string().optional(),
});

const supportAttachmentSchema = z.object({
  filename: z.string().optional(),
  content_type: z.enum(["image/png","image/jpeg","image/webp","image/gif"]).optional(),
  content_base64: z.string().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
});

const contactSupportSubmitRequestSchema = z.object({
  name: z.string().min(1),
  reply_email: z.string().email(),
  subject: z.string().min(1),
  category: supportRequestCategorySchema,
  message: z.string().min(1),
  turnstile_token: z.string().min(1),
  website: z.string().optional(),
  attachments: z.array(supportAttachmentSchema).max(2).optional(),
});

const contactSupportSubmitResponseSchema = z.object({
  ok: z.boolean(),
  data: z.object({ accepted: z.boolean() }).optional(),
  error: z.string().optional(),
});

export const generatedEdgeSchemas = {
  adminOpsRequest: adminOpsRequestSchema,
  adminOpsResponses: z.object(adminOpsResponseSchemas),
  superTenantRequest: superTenantRequestSchema,
  superTenantResponses: z.object(superTenantResponseSchemas),
  superAdminRequest: superAdminRequestSchema,
  superAdminResponses: z.object(superAdminResponseSchemas),
  superOpsRequest: superOpsRequestSchema,
  superOpsResponses: z.object(superOpsResponseSchemas),
  tenantAdminManageRequest: tenantAdminManageRequestSchema,
  tenantAdminManageResponses: z.object(tenantAdminManageResponseSchemas),
  districtDashboardResponse: districtDashboardResponseSchema,
  districtHandoffRequest: districtHandoffRequestSchema,
  districtHandoffResponses: z.object(districtHandoffResponseSchemas),
  contactSalesSubmitRequest: contactSalesSubmitRequestSchema,
  contactSalesSubmitResponse: contactSalesSubmitResponseSchema,
  contactSupportSubmitRequest: contactSupportSubmitRequestSchema,
  contactSupportSubmitResponse: contactSupportSubmitResponseSchema,
};
