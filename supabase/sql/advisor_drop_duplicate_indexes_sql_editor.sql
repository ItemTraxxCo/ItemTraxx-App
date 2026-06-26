-- SQL Editor-safe version of advisor_drop_duplicate_indexes.sql.
-- `CONCURRENTLY` is removed because the Supabase SQL editor runs inside a transaction block.
-- Apply during a low-traffic window because plain DROP INDEX can take stronger locks.

drop index if exists public.idx_districts_slug;
drop index if exists public.idx_gear_tenant_barcode;
drop index if exists public.idx_tenant_policies_tenant;
drop index if exists public.admin_audit_logs_tenant_time_idx;
