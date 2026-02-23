-- RBAC/RLS hardening baseline
-- Apply in Supabase SQL editor (idempotent).

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.tenant_id
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.current_tenant_id() to authenticated, service_role;

alter table if exists public.tenants enable row level security;
alter table if exists public.profiles enable row level security;
alter table if exists public.students enable row level security;
alter table if exists public.gear enable row level security;
alter table if exists public.gear_logs enable row level security;
alter table if exists public.admin_audit_logs enable row level security;
alter table if exists public.tenant_policies enable row level security;
alter table if exists public.tenant_security_controls enable row level security;
alter table if exists public.gear_status_history enable row level security;
alter table if exists public.app_runtime_config enable row level security;
alter table if exists public.super_alert_rules enable row level security;
alter table if exists public.super_approvals enable row level security;
alter table if exists public.super_jobs enable row level security;
alter table if exists public.super_admin_audit_logs enable row level security;

-- tenants

drop policy if exists "tenant_self_select_tenants" on public.tenants;
create policy "tenant_self_select_tenants"
on public.tenants
for select
to authenticated
using (
  public.current_user_role() in ('tenant_user', 'tenant_admin')
  and id = public.current_tenant_id()
);

drop policy if exists "super_admin_all_tenants" on public.tenants;
create policy "super_admin_all_tenants"
on public.tenants
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

-- profiles

drop policy if exists "self_select_profile" on public.profiles;
create policy "self_select_profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "tenant_admin_select_tenant_profiles" on public.profiles;
create policy "tenant_admin_select_tenant_profiles"
on public.profiles
for select
to authenticated
using (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "super_admin_all_profiles" on public.profiles;
create policy "super_admin_all_profiles"
on public.profiles
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

-- students

drop policy if exists "tenant_select_students" on public.students;
create policy "tenant_select_students"
on public.students
for select
to authenticated
using (
  public.current_user_role() in ('tenant_user', 'tenant_admin')
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "tenant_admin_write_students" on public.students;
create policy "tenant_admin_write_students"
on public.students
for all
to authenticated
using (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
)
with check (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "super_admin_all_students" on public.students;
create policy "super_admin_all_students"
on public.students
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

-- gear

drop policy if exists "tenant_select_gear" on public.gear;
create policy "tenant_select_gear"
on public.gear
for select
to authenticated
using (
  public.current_user_role() in ('tenant_user', 'tenant_admin')
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "tenant_admin_write_gear" on public.gear;
create policy "tenant_admin_write_gear"
on public.gear
for all
to authenticated
using (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
)
with check (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "super_admin_all_gear" on public.gear;
create policy "super_admin_all_gear"
on public.gear
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

-- gear logs

drop policy if exists "tenant_select_gear_logs" on public.gear_logs;
create policy "tenant_select_gear_logs"
on public.gear_logs
for select
to authenticated
using (
  public.current_user_role() in ('tenant_user', 'tenant_admin')
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "tenant_admin_insert_gear_logs" on public.gear_logs;
create policy "tenant_admin_insert_gear_logs"
on public.gear_logs
for insert
to authenticated
with check (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "super_admin_all_gear_logs" on public.gear_logs;
create policy "super_admin_all_gear_logs"
on public.gear_logs
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

-- admin audit logs

drop policy if exists "tenant_admin_select_admin_audit_logs" on public.admin_audit_logs;
create policy "tenant_admin_select_admin_audit_logs"
on public.admin_audit_logs
for select
to authenticated
using (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "tenant_admin_insert_admin_audit_logs" on public.admin_audit_logs;
create policy "tenant_admin_insert_admin_audit_logs"
on public.admin_audit_logs
for insert
to authenticated
with check (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "super_admin_all_admin_audit_logs" on public.admin_audit_logs;
create policy "super_admin_all_admin_audit_logs"
on public.admin_audit_logs
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

-- tenant policies

drop policy if exists "tenant_select_tenant_policies" on public.tenant_policies;
create policy "tenant_select_tenant_policies"
on public.tenant_policies
for select
to authenticated
using (
  public.current_user_role() in ('tenant_user', 'tenant_admin')
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "tenant_admin_write_tenant_policies" on public.tenant_policies;
create policy "tenant_admin_write_tenant_policies"
on public.tenant_policies
for all
to authenticated
using (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
)
with check (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "super_admin_all_tenant_policies" on public.tenant_policies;
create policy "super_admin_all_tenant_policies"
on public.tenant_policies
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

-- tenant security controls

drop policy if exists "tenant_admin_select_security_controls" on public.tenant_security_controls;
create policy "tenant_admin_select_security_controls"
on public.tenant_security_controls
for select
to authenticated
using (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "super_admin_all_security_controls" on public.tenant_security_controls;
create policy "super_admin_all_security_controls"
on public.tenant_security_controls
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

-- gear status history

drop policy if exists "tenant_select_gear_status_history" on public.gear_status_history;
create policy "tenant_select_gear_status_history"
on public.gear_status_history
for select
to authenticated
using (
  public.current_user_role() in ('tenant_user', 'tenant_admin')
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "tenant_admin_insert_gear_status_history" on public.gear_status_history;
create policy "tenant_admin_insert_gear_status_history"
on public.gear_status_history
for insert
to authenticated
with check (
  public.current_user_role() = 'tenant_admin'
  and tenant_id = public.current_tenant_id()
);

drop policy if exists "super_admin_all_gear_status_history" on public.gear_status_history;
create policy "super_admin_all_gear_status_history"
on public.gear_status_history
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

-- super/admin runtime tables

drop policy if exists "super_admin_all_runtime_config" on public.app_runtime_config;
create policy "super_admin_all_runtime_config"
on public.app_runtime_config
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

drop policy if exists "super_admin_all_alert_rules" on public.super_alert_rules;
create policy "super_admin_all_alert_rules"
on public.super_alert_rules
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

drop policy if exists "super_admin_all_approvals" on public.super_approvals;
create policy "super_admin_all_approvals"
on public.super_approvals
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

drop policy if exists "super_admin_all_jobs" on public.super_jobs;
create policy "super_admin_all_jobs"
on public.super_jobs
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

drop policy if exists "super_admin_all_super_audit_logs" on public.super_admin_audit_logs;
create policy "super_admin_all_super_audit_logs"
on public.super_admin_audit_logs
for all
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');
