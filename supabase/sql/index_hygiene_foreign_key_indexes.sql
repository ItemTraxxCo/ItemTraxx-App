-- Index hygiene: add covering indexes for foreign keys that are joined/filtered
-- The Supabase performance advisor flagged foreign keys without a covering index.
-- Without one, deleting a referenced row (auth.users / profiles / tenants / gear /
-- async_jobs / districts) forces a sequential scan on the child table to satisfy
-- the FK's ON DELETE CASCADE / SET NULL check.
--
-- Per the advisor's own caveat we only index FK columns that are actually joined
-- or filtered in queries (tenant_id, district_id, job_id, gear_id) and leave the
-- rarely-touched actor-style audit columns (created_by, updated_by, revoked_by,
-- approved_by, requested_by, changed_by, deleted_by, actor_id, ...) unindexed so
-- we don't add write overhead for indexes that would never be used.
--
-- FK columns of these types that were already covered are intentionally omitted:
--   - support_request_id  -> support_request_attachments/events_request_idx
--   - gear_status_history.tenant_id -> idx_gear_status_history_tenant_changed_at
--   - district_support_requests.district_id -> district_support_requests_district_created_idx
--   - tenants.district_id -> idx_tenants_district_id
--   - profiles.district_id -> idx_profiles_district_id
--   - tenant_admin_sessions.tenant_id -> tenant_admin_sessions_* indexes
--
-- Idempotent: safe to run more than once.
-- Run in the Supabase SQL editor during low traffic.

-- email_delivery_logs: tenant_id / district_id / job_id FKs (all ON DELETE SET NULL)
create index if not exists email_delivery_logs_tenant_id_idx
  on public.email_delivery_logs (tenant_id);

create index if not exists email_delivery_logs_district_id_idx
  on public.email_delivery_logs (district_id);

create index if not exists email_delivery_logs_job_id_idx
  on public.email_delivery_logs (job_id);

-- gear_status_history: gear_id FK (ON DELETE CASCADE)
create index if not exists idx_gear_status_history_gear_id
  on public.gear_status_history (gear_id);
