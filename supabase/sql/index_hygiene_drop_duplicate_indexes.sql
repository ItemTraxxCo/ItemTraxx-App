-- Index hygiene: drop redundant duplicate indexes
-- The Supabase performance advisor flagged two duplicate_index pairs on
-- low-volume admin/config tables. Duplicate indexes waste storage and add
-- overhead to every write. In each pair we keep the canonical index and drop
-- the redundant copy.
-- Idempotent: safe to run more than once.
-- Run in the Supabase SQL editor during low traffic.

-- 1. admin_audit_logs: the legacy `admin_audit_logs_tenant_time_idx` is identical
--    to `idx_admin_audit_logs_tenant_created` (both on (tenant_id, created_at desc)).
--    Keep the index tracked in performance_tuning.sql; drop the untracked legacy copy.
drop index if exists public.admin_audit_logs_tenant_time_idx;

-- 2. tenant_policies: `idx_tenant_policies_tenant` on (tenant_id) duplicates the
--    primary-key index `tenant_policies_pkey` (tenant_id is the table's primary
--    key). Keep the primary-key index; drop the redundant secondary index.
drop index if exists public.idx_tenant_policies_tenant;
