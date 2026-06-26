-- ITX-50: add covering indexes for unindexed foreign keys
-- (advisor 0001_unindexed_foreign_keys). Speeds up joins and ON DELETE/UPDATE
-- cascade checks. Exactly the 26 FKs the advisor flagged (FKs already covered
-- by a leading-column composite index are excluded).

create index if not exists idx_app_runtime_config_updated_by on public.app_runtime_config (updated_by);
create index if not exists idx_customer_status_logs_created_by on public.customer_status_logs (created_by);
create index if not exists idx_district_support_requests_requested_by on public.district_support_requests (requested_by);
create index if not exists idx_email_delivery_logs_district_id on public.email_delivery_logs (district_id);
create index if not exists idx_email_delivery_logs_job_id on public.email_delivery_logs (job_id);
create index if not exists idx_email_delivery_logs_tenant_id on public.email_delivery_logs (tenant_id);
create index if not exists idx_gear_checked_out_by on public.gear (checked_out_by);
create index if not exists idx_gear_deleted_by on public.gear (deleted_by);
create index if not exists idx_gear_logs_gear_id on public.gear_logs (gear_id);
create index if not exists idx_gear_logs_performed_by on public.gear_logs (performed_by);
create index if not exists idx_gear_status_history_changed_by on public.gear_status_history (changed_by);
create index if not exists idx_gear_status_history_gear_id on public.gear_status_history (gear_id);
create index if not exists idx_students_deleted_by on public.students (deleted_by);
create index if not exists idx_super_admin_audit_logs_actor_id on public.super_admin_audit_logs (actor_id);
create index if not exists idx_super_admin_sessions_revoked_by on public.super_admin_sessions (revoked_by);
create index if not exists idx_super_alert_rules_created_by on public.super_alert_rules (created_by);
create index if not exists idx_super_approvals_approved_by on public.super_approvals (approved_by);
create index if not exists idx_super_approvals_requested_by on public.super_approvals (requested_by);
create index if not exists idx_super_jobs_created_by on public.super_jobs (created_by);
create index if not exists idx_support_request_events_actor_id on public.support_request_events (actor_id);
create index if not exists idx_support_requests_assigned_to on public.support_requests (assigned_to);
create index if not exists idx_tenant_admin_sessions_profile_id on public.tenant_admin_sessions (profile_id);
create index if not exists idx_tenant_admin_sessions_revoked_by on public.tenant_admin_sessions (revoked_by);
create index if not exists idx_tenant_policies_updated_by on public.tenant_policies (updated_by);
create index if not exists idx_tenant_security_controls_updated_by on public.tenant_security_controls (updated_by);
create index if not exists idx_tenants_primary_admin_profile_id on public.tenants (primary_admin_profile_id);
