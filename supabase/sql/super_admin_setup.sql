-- Super admin v1 setup

alter table if exists public.tenants
  add column if not exists status text not null default 'active';

alter table if exists public.tenants
  drop constraint if exists tenants_status_check;

alter table if exists public.tenants
  add constraint tenants_status_check
  check (status in ('active', 'suspended'));

alter table if exists public.tenants
  add column if not exists primary_admin_profile_id uuid null references public.profiles(id) on delete set null;

alter table if exists public.profiles
  add column if not exists is_active boolean not null default true;

create table if not exists public.super_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  actor_email text,
  action_type text not null,
  target_type text,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.super_admin_audit_logs enable row level security;

drop policy if exists "super_admin_select_super_admin_audit_logs"
  on public.super_admin_audit_logs;

create policy "super_admin_select_super_admin_audit_logs"
  on public.super_admin_audit_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'super_admin'
    )
  );

drop policy if exists "super_admin_insert_super_admin_audit_logs"
  on public.super_admin_audit_logs;

create policy "super_admin_insert_super_admin_audit_logs"
  on public.super_admin_audit_logs
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'super_admin'
    )
  );

-- Optional helper index for dashboard/action history
create index if not exists idx_super_admin_audit_logs_created_at
  on public.super_admin_audit_logs (created_at desc);

create table if not exists public.app_runtime_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.super_alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  metric_key text not null,
  threshold numeric not null,
  is_enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_policies (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  max_admins int,
  max_students int,
  max_gear int,
  checkout_due_hours int not null default 72,
  barcode_pattern text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.super_approvals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  payload jsonb not null,
  requested_by uuid not null references auth.users(id) on delete cascade,
  approved_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.super_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  status text not null default 'queued',
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_security_controls (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  force_reauth_after timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.gear_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  gear_id uuid not null references public.gear(id) on delete cascade,
  status text not null,
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_gear_status_history_tenant_changed_at
  on public.gear_status_history (tenant_id, changed_at desc);

-- Soft delete support for tenant gear/students
alter table if exists public.gear
  add column if not exists deleted_at timestamptz;

alter table if exists public.gear
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

alter table if exists public.students
  add column if not exists deleted_at timestamptz;

alter table if exists public.students
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

alter table if exists public.students
  add column if not exists username text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'students'
      and c.column_name = 'first_name'
  ) and exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'students'
      and c.column_name = 'last_name'
  ) then
    execute $q$
      update public.students
      set username = trim(concat_ws(' ', first_name, last_name))
      where username is null or username = ''
    $q$;
  end if;
end $$;

alter table if exists public.students
  alter column username set not null;

alter table if exists public.students
  drop constraint if exists students_student_id_format_check;

alter table if exists public.students
  add constraint students_student_id_format_check
  check (student_id ~ '^[0-9]{4}[A-Z]{2}$');

alter table if exists public.students
  drop column if exists email;

alter table if exists public.students
  drop column if exists first_name;

alter table if exists public.students
  drop column if exists last_name;

create index if not exists idx_gear_tenant_deleted_at
  on public.gear (tenant_id, deleted_at);

create index if not exists idx_students_tenant_deleted_at
  on public.students (tenant_id, deleted_at);

-- Escalation thresholds for overdue reminders
alter table if exists public.tenant_policies
  add column if not exists escalation_level_1_hours int not null default 120;

alter table if exists public.tenant_policies
  add column if not exists escalation_level_2_hours int not null default 168;

alter table if exists public.tenant_policies
  add column if not exists escalation_level_3_hours int not null default 240;

alter table if exists public.tenant_policies
  add column if not exists feature_flags jsonb not null default '{
    "enable_notifications": true,
    "enable_bulk_item_import": true,
    "enable_bulk_student_tools": true,
    "enable_status_tracking": true,
    "enable_barcode_generator": true
  }'::jsonb;
