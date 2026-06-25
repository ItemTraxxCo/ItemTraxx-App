-- ITX-52: drop redundant duplicate indexes (advisor 0009_duplicate_index).
-- The `create index` statements for the first three were removed from their
-- source migrations (district_foundation.sql, performance_tuning.sql); this
-- drops the copies already deployed. The kept index of each pair is a PK or
-- UNIQUE index covering the same columns. Supabase-managed auth.*/storage.*
-- duplicates are intentionally left alone.

-- (slug) — duplicates unique districts_slug_key
drop index if exists public.idx_districts_slug;

-- (tenant_id, barcode) — duplicates unique gear_unique_barcode_per_tenant
drop index if exists public.idx_gear_tenant_barcode;

-- (tenant_id) — duplicates tenant_policies_pkey
drop index if exists public.idx_tenant_policies_tenant;

-- (tenant_id, created_at desc) — identical to idx_admin_audit_logs_tenant_created,
-- which is created in performance_tuning.sql and kept.
drop index if exists public.admin_audit_logs_tenant_time_idx;
