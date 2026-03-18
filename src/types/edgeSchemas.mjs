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

const adminOpsDevicePayloadSchema = z.object({
  device_id: z.string().min(1),
  device_label: z.string().min(1),
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
  created_at: z.string(),
  last_seen_at: z.string(),
  is_current: z.boolean(),
});

export const adminOpsRequestSchema = z.discriminatedUnion("action", [
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

export const adminOpsResponseSchemas = {
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

export const superTenantRequestSchema = z.discriminatedUnion("action", [
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

export const superTenantResponseSchemas = {
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

export const tenantAdminManageRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_tenant_admins"), payload: z.object({}) }),
  z.object({ action: z.literal("create_tenant_admin"), payload: z.object({ auth_email: z.string().email() }) }),
  z.object({ action: z.literal("set_admin_status"), payload: z.object({ id: z.string().uuid(), is_active: z.boolean() }) }),
  z.object({ action: z.literal("update_admin_email"), payload: z.object({ id: z.string().uuid(), auth_email: z.string().email() }) }),
  z.object({ action: z.literal("send_tenant_admin_reset"), payload: z.object({ auth_email: z.string().email() }) }),
]);

export const tenantAdminManageResponseSchemas = {
  list_tenant_admins: edgeEnvelopeSchema(
    z.object({
      admins: z.array(tenantManagedAdminSchema),
      can_manage_admins: z.boolean(),
      primary_admin_profile_id: z.string().uuid().nullable(),
    })
  ),
  create_tenant_admin: edgeEnvelopeSchema(z.object({ success: z.boolean(), auth_email: z.string().email() })),
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

const internalOpsSnapshotSchema = z.object({
  generated_at: z.string(),
  traffic_15m: z.object({
    checkout: z.number().int().nonnegative(),
    return: z.number().int().nonnegative(),
    active_tenants: z.number().int().nonnegative(),
  }),
  queue: z.object({
    total: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  leads: z.record(z.string(), z.number().int().nonnegative()),
  lead_funnel: z.record(z.string(), z.number().int().nonnegative()),
  traffic_by_hour: z.array(z.object({
    hour: z.string(),
    checkout: z.number().int().nonnegative(),
    return: z.number().int().nonnegative(),
  })),
  recent_logs: z.array(z.object({
    tenant_name: z.string(),
    action_type: z.string(),
    action_time: z.string(),
    gear_name: z.string().nullable().optional(),
    gear_barcode: z.string().nullable().optional(),
    borrower_name: z.string().nullable().optional(),
    borrower_id: z.string().nullable().optional(),
  })),
  runtime_config: z.record(z.string(), z.unknown()),
  recent_audit: z.array(z.object({
    id: z.string(),
    actor_email: z.string().nullable().optional(),
    action_type: z.string(),
    target_type: z.string().nullable().optional(),
    target_id: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).or(z.object({}).passthrough()).nullable().optional(),
    created_at: z.string(),
  })),
  customer_health: z.record(z.string(), z.number().int().nonnegative()),
  tenant_health: z.array(z.object({
    tenant_id: z.string(),
    tenant_name: z.string(),
    is_active: z.boolean().optional(),
    checkout_24h: z.number().int().nonnegative(),
    return_24h: z.number().int().nonnegative(),
  })).optional(),
});

export const superOpsRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_control_center"), payload: z.object({}).optional() }),
  z.object({ action: z.literal("set_runtime_config"), payload: z.object({ key: z.string().min(1), value: z.unknown() }) }),
  z.object({ action: z.literal("upsert_alert_rule"), payload: z.object({ id: z.string().optional(), name: z.string().min(1), metric_key: z.string().min(1), threshold: z.number(), is_enabled: z.boolean().optional() }) }),
  z.object({ action: z.literal("set_tenant_policy"), payload: z.object({ tenant_id: z.string().min(1), max_admins: z.number().int().nullable().optional(), max_students: z.number().int().nullable().optional(), max_gear: z.number().int().nullable().optional(), checkout_due_hours: z.number().int().nullable().optional(), barcode_pattern: z.string().nullable().optional(), feature_flags: z.record(z.string(), z.unknown()).optional() }) }),
  z.object({ action: z.literal("set_tenant_force_reauth"), payload: z.object({ tenant_id: z.string().min(1) }) }),
  z.object({ action: z.literal("create_approval"), payload: z.object({ action_type: z.string().min(1), payload: z.record(z.string(), z.unknown()).or(z.object({}).passthrough()) }) }),
  z.object({ action: z.literal("approve_request"), payload: z.object({ id: z.string().min(1) }) }),
  z.object({ action: z.literal("list_sales_leads"), payload: z.object({ search: z.string().optional(), limit: z.number().int().optional() }).optional() }),
  z.object({ action: z.literal("close_sales_lead"), payload: z.object({ lead_id: z.string().min(1) }) }),
  z.object({ action: z.literal("move_sales_lead_to_customer"), payload: z.object({ lead_id: z.string().min(1) }) }),
  z.object({ action: z.literal("set_sales_lead_stage"), payload: z.object({ lead_id: z.string().min(1), stage: z.enum(["waiting_for_quote","quote_generated","quote_sent","quote_converted_to_invoice","invoice_sent","invoice_paid"]) }) }),
  z.object({ action: z.literal("delete_sales_lead"), payload: z.object({ lead_id: z.string().min(1) }) }),
  z.object({ action: z.literal("list_customers"), payload: z.object({ search: z.string().optional(), limit: z.number().int().optional() }).optional() }),
  z.object({ action: z.literal("add_customer_status_entry"), payload: z.object({ lead_id: z.string().min(1), invoice_id: z.string().min(1), status: z.enum(["paid_on_time","paid_late","awaiting_payment","canceling"]) }) }),
  z.object({ action: z.literal("get_internal_ops_snapshot"), payload: z.object({}).optional() }),
]);

export const superOpsResponseSchemas = {
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
  list_sales_leads: edgeEnvelopeSchema(z.object({ leads: z.array(salesLeadSchema) })),
  close_sales_lead: edgeEnvelopeSchema(z.object({ lead: salesLeadSchema })),
  move_sales_lead_to_customer: edgeEnvelopeSchema(z.object({ lead: salesLeadSchema })),
  set_sales_lead_stage: edgeEnvelopeSchema(z.object({ lead: salesLeadSchema })),
  delete_sales_lead: edgeEnvelopeSchema(z.object({ deleted: z.boolean() })),
  list_customers: edgeEnvelopeSchema(z.object({ customers: z.array(customerSchema) })),
  add_customer_status_entry: edgeEnvelopeSchema(z.object({ entry: customerStatusLogSchema })),
  get_internal_ops_snapshot: edgeEnvelopeSchema(internalOpsSnapshotSchema),
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

export const superAdminRequestSchema = z.discriminatedUnion("action", [
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

export const superAdminResponseSchemas = {
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

export const districtDashboardResponseSchema = z.object({
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

export const districtHandoffRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), auth_email: z.string().email(), password: z.string().min(1), district_slug: z.string().min(1) }),
  z.object({ action: z.literal("create_admin"), email: z.string().email(), password: z.string().min(1) }),
  z.object({ action: z.literal("consume"), code: z.string().min(1) }),
]);

export const districtHandoffResponseSchemas = {
  create: z.object({ code: z.string(), expires_at: z.string() }),
  create_admin: z.object({ code: z.string().nullable(), district_slug: z.string().nullable(), role: z.enum(["tenant_admin","district_admin"]), expires_at: z.string().optional(), root_only: z.boolean().optional() }),
  consume: z.object({ access_token: z.string(), refresh_token: z.string(), district_slug: z.string() }),
};

const contactSalesPlanSchema = z.enum(["district_core","district_growth","district_enterprise","organization_starter","organization_scale","organization_enterprise","individual_yearly","individual_monthly","other"]);
const contactSalesIntentSchema = z.enum(["sales","demo"]);

export const contactSalesSubmitRequestSchema = z.object({
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

export const contactSalesSubmitResponseSchema = z.object({
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

export const contactSupportSubmitRequestSchema = z.object({
  name: z.string().min(1),
  reply_email: z.string().email(),
  subject: z.string().min(1),
  category: z.enum(["general","bug","billing","access","feature","other"]),
  message: z.string().min(1),
  turnstile_token: z.string().min(1),
  website: z.string().optional(),
  attachments: z.array(supportAttachmentSchema).max(2).optional(),
});

export const contactSupportSubmitResponseSchema = z.object({
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
