-- Database performance tuning baseline
-- Run in Supabase SQL editor during low traffic.

-- Core lookup and listing indexes
create index if not exists idx_profiles_tenant_role_active
  on public.profiles (tenant_id, role, is_active);

create index if not exists idx_profiles_auth_email
  on public.profiles (auth_email);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gear'
      and column_name = 'updated_at'
  ) then
    execute 'create index if not exists idx_gear_tenant_status_deleted on public.gear (tenant_id, status, deleted_at, updated_at desc)';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gear'
      and column_name = 'created_at'
  ) then
    execute 'create index if not exists idx_gear_tenant_status_deleted on public.gear (tenant_id, status, deleted_at, created_at desc)';
  else
    execute 'create index if not exists idx_gear_tenant_status_deleted on public.gear (tenant_id, status, deleted_at)';
  end if;
end $$;

create index if not exists idx_gear_tenant_barcode
  on public.gear (tenant_id, barcode);

create index if not exists idx_students_tenant_deleted_created
  on public.students (tenant_id, deleted_at, created_at desc);

create index if not exists idx_students_tenant_student_id
  on public.students (tenant_id, student_id);

create index if not exists idx_students_tenant_username
  on public.students (tenant_id, username);

create index if not exists idx_gear_logs_tenant_action_time
  on public.gear_logs (tenant_id, action_time desc);

create index if not exists idx_gear_logs_checked_out_by_action_time
  on public.gear_logs (checked_out_by, action_time desc);

create index if not exists idx_admin_audit_logs_tenant_created
  on public.admin_audit_logs (tenant_id, created_at desc);

create index if not exists idx_tenant_policies_tenant
  on public.tenant_policies (tenant_id);

create index if not exists idx_super_jobs_updated
  on public.super_jobs (updated_at desc);

-- Optional trigram indexes for ilike-heavy search pages
create extension if not exists pg_trgm;

create index if not exists idx_tenants_name_trgm
  on public.tenants using gin (name gin_trgm_ops);

create index if not exists idx_tenants_access_code_trgm
  on public.tenants using gin (access_code gin_trgm_ops);

create index if not exists idx_gear_name_trgm
  on public.gear using gin (name gin_trgm_ops);

create index if not exists idx_gear_barcode_trgm
  on public.gear using gin (barcode gin_trgm_ops);

create index if not exists idx_students_username_trgm
  on public.students using gin (username gin_trgm_ops);

-- Analyze for planner refresh
analyze public.tenants;
analyze public.profiles;
analyze public.students;
analyze public.gear;
analyze public.gear_logs;
analyze public.admin_audit_logs;
