-- RBAC/RLS hardening baseline
-- Apply in Supabase SQL editor (idempotent).
--
-- Policy layout note:
-- Postgres OR-evaluates every *permissive* policy that matches a given
-- (role, command) pair. A broad `for all` policy therefore overlaps any
-- narrower `for select`/`for insert` policy on the same table, leaving two or
-- more permissive policies for the same (role, command) and tripping the
-- Supabase performance advisor's `multiple_permissive_policies` warning.
-- To avoid that, every table below keeps at most ONE permissive policy per
-- command: the broad `for all` policies are expanded into explicit
-- `for insert` / `for update` / `for delete` policies, and any role that also
-- needs read/write access is merged into the matching per-command policy with
-- `OR`. This is behaviour-preserving — OR-ing predicates into one policy is
-- exactly what Postgres already did across several permissive policies.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true;
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
drop policy if exists "super_admin_all_tenants" on public.tenants;
drop policy if exists "super_admin_insert_tenants" on public.tenants;
drop policy if exists "super_admin_update_tenants" on public.tenants;
drop policy if exists "super_admin_delete_tenants" on public.tenants;

create policy "tenant_self_select_tenants"
on public.tenants
for select
to authenticated
using (
  (
    public.current_user_role() in ('tenant_user', 'tenant_admin')
    and id = public.current_tenant_id()
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "super_admin_insert_tenants"
on public.tenants
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

create policy "super_admin_update_tenants"
on public.tenants
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
)
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

create policy "super_admin_delete_tenants"
on public.tenants
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

-- profiles

drop policy if exists "self_select_profile" on public.profiles;
drop policy if exists "tenant_admin_select_tenant_profiles" on public.profiles;
drop policy if exists "super_admin_all_profiles" on public.profiles;
drop policy if exists "super_admin_insert_profiles" on public.profiles;
drop policy if exists "super_admin_update_profiles" on public.profiles;
drop policy if exists "super_admin_delete_profiles" on public.profiles;

create policy "self_select_profile"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "super_admin_insert_profiles"
on public.profiles
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

create policy "super_admin_update_profiles"
on public.profiles
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
)
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

create policy "super_admin_delete_profiles"
on public.profiles
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

-- students

drop policy if exists "tenant_select_students" on public.students;
drop policy if exists "tenant_admin_write_students" on public.students;
drop policy if exists "super_admin_all_students" on public.students;
drop policy if exists "students_insert" on public.students;
drop policy if exists "students_update" on public.students;
drop policy if exists "students_delete" on public.students;

create policy "tenant_select_students"
on public.students
for select
to authenticated
using (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "students_insert"
on public.students
for insert
to authenticated
with check (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "students_update"
on public.students
for update
to authenticated
using (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
)
with check (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "students_delete"
on public.students
for delete
to authenticated
using (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

-- gear

drop policy if exists "tenant_select_gear" on public.gear;
drop policy if exists "tenant_admin_write_gear" on public.gear;
drop policy if exists "super_admin_all_gear" on public.gear;
drop policy if exists "gear_insert" on public.gear;
drop policy if exists "gear_update" on public.gear;
drop policy if exists "gear_delete" on public.gear;

create policy "tenant_select_gear"
on public.gear
for select
to authenticated
using (
  (
    public.current_user_role() in ('tenant_user', 'tenant_admin')
    and tenant_id = public.current_tenant_id()
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "gear_insert"
on public.gear
for insert
to authenticated
with check (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "gear_update"
on public.gear
for update
to authenticated
using (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
)
with check (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "gear_delete"
on public.gear
for delete
to authenticated
using (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

-- gear logs

drop policy if exists "tenant_select_gear_logs" on public.gear_logs;
drop policy if exists "tenant_admin_insert_gear_logs" on public.gear_logs;
drop policy if exists "super_admin_all_gear_logs" on public.gear_logs;
drop policy if exists "super_admin_update_gear_logs" on public.gear_logs;
drop policy if exists "super_admin_delete_gear_logs" on public.gear_logs;

create policy "tenant_select_gear_logs"
on public.gear_logs
for select
to authenticated
using (
  (
    public.current_user_role() in ('tenant_user', 'tenant_admin')
    and tenant_id = public.current_tenant_id()
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "tenant_admin_insert_gear_logs"
on public.gear_logs
for insert
to authenticated
with check (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "super_admin_update_gear_logs"
on public.gear_logs
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
)
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

create policy "super_admin_delete_gear_logs"
on public.gear_logs
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

-- admin audit logs

drop policy if exists "tenant_admin_select_admin_audit_logs" on public.admin_audit_logs;
drop policy if exists "tenant_admin_insert_admin_audit_logs" on public.admin_audit_logs;
drop policy if exists "super_admin_all_admin_audit_logs" on public.admin_audit_logs;
drop policy if exists "super_admin_update_admin_audit_logs" on public.admin_audit_logs;
drop policy if exists "super_admin_delete_admin_audit_logs" on public.admin_audit_logs;

create policy "tenant_admin_select_admin_audit_logs"
on public.admin_audit_logs
for select
to authenticated
using (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "tenant_admin_insert_admin_audit_logs"
on public.admin_audit_logs
for insert
to authenticated
with check (
  (
    public.current_user_role() = 'tenant_admin'
    and actor_id = auth.uid()
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
    and actor_id = auth.uid()
  )
);

create policy "super_admin_update_admin_audit_logs"
on public.admin_audit_logs
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
)
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
  and actor_id = auth.uid()
);

create policy "super_admin_delete_admin_audit_logs"
on public.admin_audit_logs
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

-- tenant policies

drop policy if exists "tenant_select_tenant_policies" on public.tenant_policies;
drop policy if exists "tenant_admin_write_tenant_policies" on public.tenant_policies;
drop policy if exists "super_admin_all_tenant_policies" on public.tenant_policies;
drop policy if exists "tenant_policies_insert" on public.tenant_policies;
drop policy if exists "tenant_policies_update" on public.tenant_policies;
drop policy if exists "tenant_policies_delete" on public.tenant_policies;

create policy "tenant_select_tenant_policies"
on public.tenant_policies
for select
to authenticated
using (
  (
    public.current_user_role() in ('tenant_user', 'tenant_admin')
    and tenant_id = public.current_tenant_id()
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "tenant_policies_insert"
on public.tenant_policies
for insert
to authenticated
with check (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "tenant_policies_update"
on public.tenant_policies
for update
to authenticated
using (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
)
with check (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "tenant_policies_delete"
on public.tenant_policies
for delete
to authenticated
using (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

-- tenant security controls

drop policy if exists "tenant_admin_select_security_controls" on public.tenant_security_controls;
drop policy if exists "super_admin_all_security_controls" on public.tenant_security_controls;
drop policy if exists "super_admin_insert_security_controls" on public.tenant_security_controls;
drop policy if exists "super_admin_update_security_controls" on public.tenant_security_controls;
drop policy if exists "super_admin_delete_security_controls" on public.tenant_security_controls;

create policy "tenant_admin_select_security_controls"
on public.tenant_security_controls
for select
to authenticated
using (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "super_admin_insert_security_controls"
on public.tenant_security_controls
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

create policy "super_admin_update_security_controls"
on public.tenant_security_controls
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
)
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

create policy "super_admin_delete_security_controls"
on public.tenant_security_controls
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

-- gear status history

drop policy if exists "tenant_select_gear_status_history" on public.gear_status_history;
drop policy if exists "tenant_admin_insert_gear_status_history" on public.gear_status_history;
drop policy if exists "super_admin_all_gear_status_history" on public.gear_status_history;
drop policy if exists "super_admin_update_gear_status_history" on public.gear_status_history;
drop policy if exists "super_admin_delete_gear_status_history" on public.gear_status_history;

create policy "tenant_select_gear_status_history"
on public.gear_status_history
for select
to authenticated
using (
  (
    public.current_user_role() in ('tenant_user', 'tenant_admin')
    and tenant_id = public.current_tenant_id()
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "tenant_admin_insert_gear_status_history"
on public.gear_status_history
for insert
to authenticated
with check (
  (
    public.current_user_role() = 'tenant_admin'
    and tenant_id = public.current_tenant_id()
    and public.has_recent_privileged_step_up('tenant_admin')
  )
  or (
    public.current_user_role() = 'super_admin'
    and public.has_recent_privileged_step_up('super_admin')
  )
);

create policy "super_admin_update_gear_status_history"
on public.gear_status_history
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
)
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

create policy "super_admin_delete_gear_status_history"
on public.gear_status_history
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

-- super/admin runtime tables

drop policy if exists "super_admin_all_runtime_config" on public.app_runtime_config;
create policy "super_admin_all_runtime_config"
on public.app_runtime_config
for all
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
)
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

drop policy if exists "super_admin_all_alert_rules" on public.super_alert_rules;
create policy "super_admin_all_alert_rules"
on public.super_alert_rules
for all
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
)
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

drop policy if exists "super_admin_all_approvals" on public.super_approvals;
create policy "super_admin_all_approvals"
on public.super_approvals
for all
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
)
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

drop policy if exists "super_admin_all_jobs" on public.super_jobs;
create policy "super_admin_all_jobs"
on public.super_jobs
for all
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
)
with check (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

drop policy if exists "super_admin_all_super_audit_logs" on public.super_admin_audit_logs;
drop policy if exists "super_admin_select_super_audit_logs" on public.super_admin_audit_logs;
drop policy if exists "super_admin_insert_super_audit_logs" on public.super_admin_audit_logs;

create policy "super_admin_select_super_audit_logs"
on public.super_admin_audit_logs
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);

create policy "super_admin_insert_super_audit_logs"
on public.super_admin_audit_logs
for insert
to authenticated
with check (
  actor_id = auth.uid()
  and
  public.current_user_role() = 'super_admin'
  and public.has_recent_privileged_step_up('super_admin')
);
