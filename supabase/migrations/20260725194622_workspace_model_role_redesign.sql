-- ItemTraxx workspace model and role redesign.
--
-- This migration is intentionally able to run against both:
--   1. the current production-shaped schema (tenants + districts), and
--   2. a new/empty staging project.
--
-- account_category remains unchanged. Primary workspace admin reassignment is
-- deliberately not exposed by any workspace-scoped policy or RPC.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Fail safely when an old district administrator cannot be mapped to exactly
-- one tenant. The current live schema was inspected before this migration was
-- authored; this guard prevents a future ambiguous migration from guessing.
do $$
declare
  ambiguous_mapping boolean := false;
begin
  if to_regclass('public.tenants') is not null
     and to_regclass('public.districts') is not null
     and to_regclass('public.profiles') is not null then
    execute $query$
      select exists (
        select 1
        from public.profiles p
        where p.role = 'district_admin'
          and (
            select count(*)
            from public.tenants t
            where t.district_id = p.district_id
          ) <> 1
      )
    $query$ into ambiguous_mapping;
    if ambiguous_mapping then
      raise exception 'Workspace migration blocked: a district admin does not map to exactly one tenant';
    end if;
  end if;
end $$;

-- Materialized views retain hard dependencies on the old names.
drop materialized view if exists public.super_reporting_tenant_metrics;

do $$
begin
  if to_regclass('public.tenants') is not null
     and to_regclass('public.workspaces') is null then
    alter table public.tenants rename to workspaces;
  end if;
end $$;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  status text not null default 'active',
  primary_admin_profile_id uuid null,
  archived_at timestamptz null,
  purge_after timestamptz null,
  purge_state text not null default 'none',
  purged_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table public.workspaces add column if not exists slug text;
alter table public.workspaces add column if not exists archived_at timestamptz;
alter table public.workspaces add column if not exists purge_after timestamptz;
alter table public.workspaces add column if not exists purge_state text not null default 'none';
alter table public.workspaces add column if not exists purged_at timestamptz;
alter table public.workspaces add column if not exists status text not null default 'active';
alter table public.workspaces add column if not exists primary_admin_profile_id uuid null;

do $$
begin
  if to_regclass('public.districts') is not null then
    update public.workspaces w
    set slug = d.slug
    from public.districts d
    where w.district_id = d.id
      and (w.slug is null or btrim(w.slug) = '');
  end if;
end $$;

-- Standalone legacy tenants did not have slugs. Use a deterministic, unique,
-- human-readable value rather than treating the old access code as a secret URL.
update public.workspaces
set slug = left(
  trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')),
  45
) || '-' || left(id::text, 8)
where slug is null or btrim(slug) = '';

alter table public.workspaces alter column slug set not null;
alter table public.workspaces drop constraint if exists tenants_status_check;
alter table public.workspaces drop constraint if exists workspaces_status_check;
alter table public.workspaces add constraint workspaces_status_check
  check (status in ('active', 'suspended'));
alter table public.workspaces drop constraint if exists workspaces_purge_state_check;
alter table public.workspaces add constraint workspaces_purge_state_check
  check (purge_state in ('none', 'grace', 'pending', 'purging', 'purged'));
alter table public.workspaces drop constraint if exists workspaces_slug_format_check;
alter table public.workspaces add constraint workspaces_slug_format_check
  check (slug ~ '^[a-z0-9-]{2,63}$');
create unique index if not exists workspaces_slug_key on public.workspaces (slug);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid null references public.workspaces(id),
  role text not null,
  created_at timestamptz not null default now(),
  auth_email text null,
  is_active boolean not null default true,
  deleted_at timestamptz null
);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='tenant_id')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='workspace_id') then
    alter table public.profiles rename column tenant_id to workspace_id;
  end if;
end $$;
alter table public.profiles add column if not exists workspace_id uuid null;
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists deleted_at timestamptz null;

do $$
begin
  if to_regclass('public.districts') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='district_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspaces' and column_name='district_id') then
    update public.profiles p
    set workspace_id = w.id
    from public.workspaces w
    where p.workspace_id is null
      and p.district_id = w.district_id;
  end if;
end $$;

update public.profiles set role = 'workspace_admin' where role in ('tenant_admin', 'district_admin');
update public.profiles set role = 'tenant_account' where role = 'tenant_user';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('super_admin', 'workspace_admin', 'tenant_account'));

-- Workspace-scoped core tables. The CREATE branches make the migration usable
-- by the clean staging project; production takes the ALTER/rename path.
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  student_id text null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null,
  deleted_by uuid null references auth.users(id) on delete set null,
  username text not null,
  access_mode text not null default 'all'
);
create table if not exists public.gear (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  status text not null,
  notes text null,
  created_at timestamptz not null default now(),
  barcode text null,
  checked_out_by uuid null references public.students(id) on update cascade on delete set null,
  checked_out_at timestamptz null,
  serial_number text null,
  deleted_at timestamptz null,
  deleted_by uuid null references auth.users(id) on delete set null,
  access_mode text not null default 'all'
);
create table if not exists public.gear_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  gear_id uuid not null references public.gear(id),
  checked_out_by uuid not null references public.students(id),
  action_type text null,
  action_time timestamptz not null default now(),
  performed_by uuid null references auth.users(id),
  operation_id text null
);
create table if not exists public.gear_status_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  gear_id uuid not null references public.gear(id) on delete cascade,
  status text not null,
  note text null,
  changed_by uuid null references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action_type text not null,
  entity_type text null,
  entity_id uuid null,
  metadata jsonb null,
  created_at timestamptz not null default now()
);
create table if not exists public.rate_limits (
  workspace_id uuid not null,
  actor_id uuid not null,
  scope text not null,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  primary key (workspace_id, actor_id, scope, window_start)
);

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'students','gear','gear_logs','gear_status_history','admin_audit_logs','rate_limits'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=target_table and column_name='tenant_id'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=target_table and column_name='workspace_id'
    ) then
      execute format('alter table public.%I rename column tenant_id to workspace_id', target_table);
    end if;
  end loop;
end $$;

alter table public.gear add column if not exists access_mode text not null default 'all';
alter table public.students add column if not exists access_mode text not null default 'all';
alter table public.gear drop constraint if exists gear_access_mode_check;
alter table public.gear add constraint gear_access_mode_check check (access_mode in ('all','restricted'));
alter table public.students drop constraint if exists students_access_mode_check;
alter table public.students add constraint students_access_mode_check check (access_mode in ('all','restricted'));

do $$
begin
  if to_regclass('public.tenant_policies') is not null and to_regclass('public.workspace_policies') is null then
    alter table public.tenant_policies rename to workspace_policies;
  end if;
  if to_regclass('public.tenant_security_controls') is not null and to_regclass('public.workspace_security_controls') is null then
    alter table public.tenant_security_controls rename to workspace_security_controls;
  end if;
end $$;

create table if not exists public.workspace_policies (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  max_admins integer null,
  max_students integer null,
  max_gear integer null,
  barcode_pattern text null,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  checkout_due_hours integer not null default 72,
  escalation_level_1_hours integer not null default 120,
  escalation_level_2_hours integer not null default 168,
  escalation_level_3_hours integer not null default 240,
  account_category text not null default 'organization',
  plan_code text null,
  feature_flags jsonb not null default '{"enable_notifications":true,"enable_status_tracking":true,"enable_bulk_item_import":true,"enable_barcode_generator":true,"enable_bulk_student_tools":true}'::jsonb,
  contact_name text null,
  support_email text null,
  billing_email text null,
  billing_status text null,
  renewal_date date null,
  invoice_reference text null
);
create table if not exists public.workspace_security_controls (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  force_reauth_after timestamptz null,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

do $$
declare
  target_table text;
begin
  foreach target_table in array array['workspace_policies','workspace_security_controls'] loop
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=target_table and column_name='tenant_id')
       and not exists (select 1 from information_schema.columns where table_schema='public' and table_name=target_table and column_name='workspace_id') then
      execute format('alter table public.%I rename column tenant_id to workspace_id', target_table);
    end if;
  end loop;
end $$;

alter table public.workspace_policies add column if not exists contact_name text null;
alter table public.workspace_policies add column if not exists support_email text null;
alter table public.workspace_policies add column if not exists billing_email text null;
alter table public.workspace_policies add column if not exists billing_status text null;
alter table public.workspace_policies add column if not exists renewal_date date null;
alter table public.workspace_policies add column if not exists invoice_reference text null;

do $$
begin
  if to_regclass('public.districts') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspaces' and column_name='district_id') then
    insert into public.workspace_policies (
      workspace_id, plan_code, contact_name, support_email, billing_email,
      billing_status, renewal_date, invoice_reference
    )
    select w.id,
      case d.subscription_plan
        when 'district_core' then 'core'
        when 'district_growth' then 'growth'
        when 'district_enterprise' then 'enterprise'
        when 'organization_starter' then 'starter'
        when 'organization_scale' then 'scale'
        when 'organization_enterprise' then 'enterprise'
        else null
      end,
      d.contact_name, d.support_email, d.billing_email, d.billing_status,
      d.renewal_date, d.invoice_reference
    from public.workspaces w
    join public.districts d on d.id = w.district_id
    on conflict (workspace_id) do update set
      contact_name = excluded.contact_name,
      support_email = excluded.support_email,
      billing_email = excluded.billing_email,
      billing_status = excluded.billing_status,
      renewal_date = excluded.renewal_date,
      invoice_reference = excluded.invoice_reference,
      plan_code = coalesce(public.workspace_policies.plan_code, excluded.plan_code);
  end if;
end $$;

-- Account-specific access grants. Foreign-key indexes are explicit because
-- PostgreSQL does not create them automatically.
create table if not exists public.gear_access_grants (
  gear_id uuid not null references public.gear(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid null references public.profiles(id) on delete set null,
  primary key (gear_id, profile_id)
);
create table if not exists public.borrower_access_grants (
  student_id uuid not null references public.students(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid null references public.profiles(id) on delete set null,
  primary key (student_id, profile_id)
);
create index if not exists gear_access_grants_profile_idx on public.gear_access_grants(profile_id, gear_id);
create index if not exists borrower_access_grants_profile_idx on public.borrower_access_grants(profile_id, student_id);
create index if not exists gear_access_grants_granted_by_idx on public.gear_access_grants(granted_by);
create index if not exists borrower_access_grants_granted_by_idx on public.borrower_access_grants(granted_by);

-- Generalized application session registry. auth_session_id is the JWT
-- session_id claim and is what lets policies reject a revoked JWT immediately.
do $$
begin
  if to_regclass('public.tenant_admin_sessions') is not null and to_regclass('public.account_sessions') is null then
    alter table public.tenant_admin_sessions rename to account_sessions;
  end if;
end $$;
create table if not exists public.account_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  device_label text null,
  user_agent text null,
  login_method text null,
  login_location text null,
  general_location text null,
  auth_session_id text null,
  auth_token_hash text null,
  auth_token_issued_at timestamptz null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by uuid null references public.profiles(id) on delete set null
);
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='account_sessions' and column_name='tenant_id')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='account_sessions' and column_name='workspace_id') then
    alter table public.account_sessions rename column tenant_id to workspace_id;
  end if;
end $$;
alter table public.account_sessions add column if not exists auth_token_hash text null;
create index if not exists account_sessions_profile_active_idx
  on public.account_sessions(workspace_id, profile_id, last_seen_at desc) where revoked_at is null;
create index if not exists account_sessions_auth_session_idx
  on public.account_sessions(profile_id, auth_session_id) where revoked_at is null and auth_session_id is not null;
create index if not exists account_sessions_revoked_by_idx on public.account_sessions(revoked_by);

-- Authentication/security dependencies used by the rewritten edge functions.
-- These already exist in production; CREATE IF NOT EXISTS makes the empty
-- staging project capable of exercising the workspace auth path.
create table if not exists public.privileged_session_stepups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_scope text not null check (role_scope in ('super_admin','workspace_admin')),
  binding_key text not null,
  issued_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.privileged_session_stepups drop constraint if exists privileged_session_stepups_role_scope_check;
update public.privileged_session_stepups
set role_scope = 'workspace_admin'
where role_scope in ('tenant_admin', 'district_admin');
alter table public.privileged_session_stepups add constraint privileged_session_stepups_role_scope_check
  check (role_scope in ('super_admin','workspace_admin'));
create unique index if not exists privileged_session_stepups_binding_uidx
  on public.privileged_session_stepups(user_id,role_scope,binding_key);
create index if not exists privileged_session_stepups_lookup_idx
  on public.privileged_session_stepups(user_id,role_scope,expires_at desc);

create table if not exists public.super_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  device_label text null,
  user_agent text null,
  login_method text null,
  login_location text null,
  general_location text null,
  auth_session_id text null,
  auth_token_issued_at timestamptz null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by uuid null references public.profiles(id) on delete set null
);
create index if not exists super_admin_sessions_profile_active_idx
  on public.super_admin_sessions(profile_id,last_seen_at desc) where revoked_at is null;
create index if not exists super_admin_sessions_auth_session_revoked_idx
  on public.super_admin_sessions(profile_id,auth_session_id,revoked_at desc)
  where auth_session_id is not null and revoked_at is not null;

create table if not exists public.app_runtime_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Workspace attribution on telemetry/support surfaces. Existing privacy and
-- billing classification values are retained exactly.
alter table if exists public.cookie_consent_records add column if not exists workspace_id uuid null references public.workspaces(id) on delete set null;
do $$
begin
  if to_regclass('public.cookie_consent_records') is not null then
    update public.cookie_consent_records c set workspace_id = p.workspace_id
    from public.profiles p where c.workspace_id is null and c.profile_id = p.id;
  end if;
end $$;
alter table if exists public.client_error_reports add column if not exists workspace_id uuid null references public.workspaces(id) on delete set null;
do $$
begin
  if to_regclass('public.client_error_reports') is not null then
    update public.client_error_reports
    set workspace_id = tenant_context_id::uuid
    where workspace_id is null
      and tenant_context_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  end if;
end $$;

alter table if exists public.support_requests add column if not exists workspace_id uuid null references public.workspaces(id) on delete set null;
alter table if exists public.support_requests drop constraint if exists support_requests_source_check;
alter table if exists public.support_requests add constraint support_requests_source_check
  check (source in ('public_form','workspace'));
do $$
begin
  if to_regclass('public.district_support_requests') is not null
     and to_regclass('public.support_requests') is not null then
    insert into public.support_requests (
      id, workspace_id, requester_name, reply_email, subject, category,
      message, source, status, created_at, updated_at
    )
    select dsr.id, w.id, coalesce(dsr.requester_name, 'Workspace user'),
      coalesce(dsr.requester_email, 'support@itemtraxx.com'), dsr.subject,
      'general', dsr.message, 'workspace',
      case when dsr.status in ('open','in_progress','resolved') then dsr.status else 'open' end,
      dsr.created_at, dsr.updated_at
    from public.district_support_requests dsr
    join public.workspaces w on w.district_id = dsr.district_id
    on conflict (id) do nothing;
  end if;
end $$;

do $$
begin
  if to_regclass('public.email_delivery_logs') is not null then
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='email_delivery_logs' and column_name='workspace_id') then
      alter table public.email_delivery_logs add column workspace_id uuid null references public.workspaces(id) on delete set null;
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='email_delivery_logs' and column_name='tenant_id') then
      update public.email_delivery_logs set workspace_id = tenant_id where workspace_id is null;
    end if;
    if to_regclass('public.districts') is not null
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='email_delivery_logs' and column_name='district_id') then
      update public.email_delivery_logs e set workspace_id = w.id
      from public.workspaces w where e.workspace_id is null and e.district_id = w.district_id;
    end if;
  end if;
end $$;

-- Foreign keys and indexes after legacy column renames.
create index if not exists profiles_workspace_role_active_idx on public.profiles(workspace_id, role, is_active) where deleted_at is null;
create index if not exists gear_workspace_status_deleted_idx on public.gear(workspace_id, status, deleted_at);
create index if not exists students_workspace_deleted_idx on public.students(workspace_id, deleted_at);
create index if not exists gear_logs_workspace_time_idx on public.gear_logs(workspace_id, action_time desc);
create index if not exists gear_status_history_workspace_time_idx on public.gear_status_history(workspace_id, changed_at desc);
create index if not exists admin_audit_logs_workspace_time_idx on public.admin_audit_logs(workspace_id, created_at desc);
create unique index if not exists gear_active_workspace_barcode_unique on public.gear(workspace_id, barcode) where deleted_at is null and barcode is not null;
drop index if exists public.students_active_tenant_student_id_unique;
drop index if exists public.students_active_tenant_username_unique;
create unique index if not exists students_active_workspace_student_id_unique on public.students(workspace_id, student_id) where deleted_at is null;
create unique index if not exists students_active_workspace_username_unique on public.students(workspace_id, lower(username)) where deleted_at is null;

-- Remove obsolete district columns/tables only after all data has been folded.
do $$
declare target_table text; policy_name text;
begin
  foreach target_table in array array['workspaces','profiles','students','gear','gear_logs','gear_status_history','workspace_policies','workspace_security_controls','admin_audit_logs','account_sessions'] loop
    if to_regclass(format('public.%I',target_table)) is not null then
      for policy_name in select pol.polname from pg_policy pol where pol.polrelid=format('public.%I',target_table)::regclass loop
        execute format('drop policy %I on public.%I',policy_name,target_table);
      end loop;
    end if;
  end loop;
end $$;
drop function if exists public.current_tenant_id();
drop function if exists public.current_district_id();
drop function if exists public.resolve_public_district_by_id(uuid);
drop function if exists public.resolve_public_district_by_slug(text);
drop function if exists public.create_student_identity(uuid,text,text);
alter table if exists public.email_delivery_logs drop column if exists tenant_id;
alter table if exists public.email_delivery_logs drop column if exists district_id;
alter table if exists public.client_error_reports drop column if exists tenant_context_id;
alter table if exists public.client_error_reports drop column if exists district_context_id;
alter table if exists public.client_error_reports drop column if exists is_district_host;
alter table if exists public.client_error_reports drop column if exists district_id;
drop table if exists public.district_support_requests;
alter table if exists public.profiles drop column if exists district_id;
alter table if exists public.workspaces drop column if exists district_id;
alter table if exists public.workspaces drop column if exists access_code;
drop table if exists public.district_session_handoffs_v4;
drop table if exists public.district_session_handoffs_v3;
drop table if exists public.district_session_handoffs_v2;
drop table if exists public.district_session_handoffs;
drop table if exists public.district_subscription_plan_alignment;
drop table if exists public.district_subscription_fields;
drop table if exists public.districts;

-- Replace old helper/RPC contracts.
drop function if exists public.current_tenant_id();
drop function if exists public.current_district_id();
drop function if exists public.resolve_public_district_by_id(uuid);
drop function if exists public.resolve_public_district_by_slug(text);
drop function if exists public.create_student_identity(uuid,text,text);

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.is_active and p.deleted_at is null;
$$;
create or replace function public.current_workspace_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.workspace_id from public.profiles p
  where p.id = (select auth.uid()) and p.is_active and p.deleted_at is null;
$$;

create or replace function private.current_account_session_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when (select public.current_user_role()) = 'super_admin' then true
    else exists (
      select 1
      from public.account_sessions a
      join auth.sessions s on s.id::text = a.auth_session_id
      where a.profile_id = (select auth.uid())
        and s.user_id = (select auth.uid())
        and a.auth_session_id = (select auth.jwt() ->> 'session_id')
        and a.revoked_at is null
    )
  end;
$$;

-- Security-definer predicates keep grant-table RLS from recursively invoking
-- the gear/student policies that reference those same grants.
create or replace function private.current_profile_can_access_gear(
  p_gear_id uuid, p_access_mode text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_access_mode = 'all' or exists (
    select 1 from public.gear_access_grants g
    where g.gear_id = p_gear_id and g.profile_id = (select auth.uid())
  );
$$;
create or replace function private.current_profile_can_access_borrower(
  p_student_id uuid, p_access_mode text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_access_mode = 'all' or exists (
    select 1 from public.borrower_access_grants g
    where g.student_id = p_student_id and g.profile_id = (select auth.uid())
  );
$$;
create or replace function private.gear_is_in_current_workspace(p_gear_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.gear g where g.id=p_gear_id and g.workspace_id=(select public.current_workspace_id()));
$$;
create or replace function private.borrower_is_in_current_workspace(p_student_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.students s where s.id=p_student_id and s.workspace_id=(select public.current_workspace_id()));
$$;

create or replace function public.resolve_public_workspace_by_slug(p_slug text)
returns table(id uuid, name text, slug text, status text)
language sql stable security definer set search_path = '' as $$
  select w.id, w.name, w.slug, w.status
  from public.workspaces w
  where w.slug = lower(trim(p_slug)) and w.status = 'active';
$$;
create or replace function public.resolve_public_workspace_by_id(p_id uuid)
returns table(id uuid, name text, slug text, status text)
language sql stable security definer set search_path = '' as $$
  select w.id, w.name, w.slug, w.status
  from public.workspaces w where w.id = p_id and w.status = 'active';
$$;

create or replace function public.create_borrower_identity(
  p_workspace_id uuid, p_username text, p_student_id text,
  p_access_mode text, p_profile_ids uuid[] default '{}'::uuid[]
)
returns table(id uuid, workspace_id uuid, username text, student_id text, access_mode text)
language plpgsql security definer set search_path = '' as $$
declare
  normalized_username text := coalesce(trim(p_username), '');
  normalized_student_id text := upper(coalesce(trim(p_student_id), ''));
  created_id uuid;
begin
  if p_workspace_id is null or p_workspace_id <> (select public.current_workspace_id())
     or (select public.current_user_role()) <> 'workspace_admin'
     or not (select private.current_account_session_is_active()) then
    raise exception 'Unauthorized';
  end if;
  if p_access_mode not in ('all','restricted')
     or (p_access_mode = 'restricted' and cardinality(p_profile_ids) = 0) then
    raise exception 'Access choice is required' using errcode='22023';
  end if;
  if normalized_username = '' or normalized_student_id = '' then
    raise exception 'Borrower identity is required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':student_id:' || normalized_student_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':username:' || lower(normalized_username), 0));
  insert into public.students(workspace_id,username,student_id,access_mode)
  values(p_workspace_id,normalized_username,normalized_student_id,p_access_mode)
  returning students.id into created_id;
  if p_access_mode = 'restricted' then
    if exists (
      select 1 from unnest(p_profile_ids) target(profile_id)
      left join public.profiles p on p.id=target.profile_id
      where p.id is null or p.workspace_id<>p_workspace_id or p.role<>'tenant_account'
        or not p.is_active or p.deleted_at is not null
    ) then
      raise exception 'Invalid Tenant Account grant' using errcode='22023';
    end if;
    insert into public.borrower_access_grants(student_id,profile_id,granted_by)
    select created_id, profile_id, (select auth.uid()) from unnest(p_profile_ids) profile_id;
  end if;
  return query select s.id,s.workspace_id,s.username,s.student_id,s.access_mode from public.students s where s.id=created_id;
end $$;

-- RLS is rebuilt as one focused pass. Service-role edge functions retain their
-- bypass while every browser-accessible workspace row checks workspace + session.
do $$
declare
  target_table text;
  policy_name text;
begin
  foreach target_table in array array[
    'workspaces','profiles','students','gear','gear_logs','gear_status_history',
    'workspace_policies','workspace_security_controls','admin_audit_logs',
    'account_sessions','gear_access_grants','borrower_access_grants'
  ] loop
    execute format('alter table public.%I enable row level security', target_table);
    for policy_name in select pol.polname from pg_policy pol where pol.polrelid=format('public.%I',target_table)::regclass loop
      execute format('drop policy %I on public.%I', policy_name, target_table);
    end loop;
  end loop;
end $$;

create policy workspace_self_select on public.workspaces for select to authenticated
using (id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy super_admin_all_workspaces on public.workspaces for all to authenticated
using ((select public.current_user_role())='super_admin')
with check ((select public.current_user_role())='super_admin');

create policy self_select_profile on public.profiles for select to authenticated
using (id=(select auth.uid()) and is_active and deleted_at is null);
create policy workspace_admin_select_profiles on public.profiles for select to authenticated
using ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy super_admin_all_profiles on public.profiles for all to authenticated
using ((select public.current_user_role())='super_admin') with check ((select public.current_user_role())='super_admin');

create policy workspace_members_select_gear on public.gear for select to authenticated using (
  workspace_id=(select public.current_workspace_id())
  and deleted_at is null
  and (select private.current_account_session_is_active())
  and (
    (select public.current_user_role())='workspace_admin'
    or ((select public.current_user_role())='tenant_account' and (
      (select private.current_profile_can_access_gear(gear.id, gear.access_mode))
    ))
  )
);
create policy workspace_admin_write_gear on public.gear for all to authenticated
using ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()))
with check ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy super_admin_all_gear on public.gear for all to authenticated
using ((select public.current_user_role())='super_admin') with check ((select public.current_user_role())='super_admin');

create policy workspace_members_select_students on public.students for select to authenticated using (
  workspace_id=(select public.current_workspace_id())
  and deleted_at is null
  and (select private.current_account_session_is_active())
  and (
    (select public.current_user_role())='workspace_admin'
    or ((select public.current_user_role())='tenant_account' and (
      (select private.current_profile_can_access_borrower(students.id, students.access_mode))
    ))
  )
);
create policy workspace_admin_write_students on public.students for all to authenticated
using ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()))
with check ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy super_admin_all_students on public.students for all to authenticated
using ((select public.current_user_role())='super_admin') with check ((select public.current_user_role())='super_admin');

create policy workspace_admin_select_logs on public.gear_logs for select to authenticated
using ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy super_admin_all_logs on public.gear_logs for all to authenticated
using ((select public.current_user_role())='super_admin') with check ((select public.current_user_role())='super_admin');
create policy workspace_admin_select_status_history on public.gear_status_history for select to authenticated
using ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy workspace_admin_write_status_history on public.gear_status_history for insert to authenticated
with check ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy super_admin_all_status_history on public.gear_status_history for all to authenticated
using ((select public.current_user_role())='super_admin') with check ((select public.current_user_role())='super_admin');

create policy workspace_members_select_policies on public.workspace_policies for select to authenticated
using (workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy workspace_admin_write_policies on public.workspace_policies for all to authenticated
using ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()))
with check ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy super_admin_all_policies on public.workspace_policies for all to authenticated
using ((select public.current_user_role())='super_admin') with check ((select public.current_user_role())='super_admin');

create policy workspace_admin_select_security_controls on public.workspace_security_controls for select to authenticated
using ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy super_admin_all_security_controls on public.workspace_security_controls for all to authenticated
using ((select public.current_user_role())='super_admin') with check ((select public.current_user_role())='super_admin');
create policy workspace_admin_select_audit on public.admin_audit_logs for select to authenticated
using ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and (select private.current_account_session_is_active()));
create policy workspace_admin_insert_audit on public.admin_audit_logs for insert to authenticated
with check ((select public.current_user_role())='workspace_admin' and workspace_id=(select public.current_workspace_id()) and actor_id=(select auth.uid()) and (select private.current_account_session_is_active()));
create policy super_admin_all_audit on public.admin_audit_logs for all to authenticated
using ((select public.current_user_role())='super_admin') with check ((select public.current_user_role())='super_admin');

create policy account_sessions_select_own on public.account_sessions for select to authenticated
using (profile_id=(select auth.uid()) and workspace_id=(select public.current_workspace_id()));
create policy access_grants_workspace_admin_all_gear on public.gear_access_grants for all to authenticated
using ((select public.current_user_role())='workspace_admin' and (select private.gear_is_in_current_workspace(gear_access_grants.gear_id)) and (select private.current_account_session_is_active()))
with check ((select public.current_user_role())='workspace_admin' and (select private.gear_is_in_current_workspace(gear_access_grants.gear_id)) and (select private.current_account_session_is_active()));
create policy access_grants_tenant_account_select_gear on public.gear_access_grants for select to authenticated
using (profile_id=(select auth.uid()) and (select private.current_account_session_is_active()));
create policy access_grants_workspace_admin_all_borrowers on public.borrower_access_grants for all to authenticated
using ((select public.current_user_role())='workspace_admin' and (select private.borrower_is_in_current_workspace(borrower_access_grants.student_id)) and (select private.current_account_session_is_active()))
with check ((select public.current_user_role())='workspace_admin' and (select private.borrower_is_in_current_workspace(borrower_access_grants.student_id)) and (select private.current_account_session_is_active()));
create policy access_grants_tenant_account_select_borrowers on public.borrower_access_grants for select to authenticated
using (profile_id=(select auth.uid()) and (select private.current_account_session_is_active()));

-- Tenant-account dashboard totals. Shared rows count once for each account to
-- which they are available, intentionally preserving overlap.
create or replace function public.workspace_account_dashboard()
returns table(
  profile_id uuid, auth_email text, item_count bigint, borrower_count bigint,
  active_checkouts bigint, overdue_count bigint
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.auth_email,
    (select count(*) from public.gear g where g.workspace_id=p.workspace_id and g.deleted_at is null and (g.access_mode='all' or exists(select 1 from public.gear_access_grants gag where gag.gear_id=g.id and gag.profile_id=p.id))),
    (select count(*) from public.students s where s.workspace_id=p.workspace_id and s.deleted_at is null and (s.access_mode='all' or exists(select 1 from public.borrower_access_grants bag where bag.student_id=s.id and bag.profile_id=p.id))),
    (select count(*) from public.gear_logs gl where gl.workspace_id=p.workspace_id and gl.performed_by=p.id and gl.action_type='checkout' and not exists(select 1 from public.gear_logs returned where returned.gear_id=gl.gear_id and returned.action_time>gl.action_time and returned.action_type in ('return','quick_return','admin_return'))),
    (select count(*) from public.gear g join public.gear_logs gl on gl.gear_id=g.id where gl.workspace_id=p.workspace_id and gl.performed_by=p.id and gl.action_type='checkout' and g.status='checked_out' and g.checked_out_at < now() - make_interval(hours=>coalesce((select wp.checkout_due_hours from public.workspace_policies wp where wp.workspace_id=p.workspace_id),72)))
  from public.profiles p
  where p.workspace_id=(select public.current_workspace_id())
    and p.role='tenant_account' and p.is_active and p.deleted_at is null
    and (select public.current_user_role())='workspace_admin'
    and (select private.current_account_session_is_active());
$$;

-- Reporting view for Super Admin keeps cross-workspace capability and naming.
create materialized view public.super_reporting_workspace_metrics as
with gear_counts as (
  select workspace_id, count(*) filter(where deleted_at is null) gear_total,
    count(*) filter(where deleted_at is null and status='checked_out') active_checkouts,
    count(*) filter(where deleted_at is null and status='checked_out' and checked_out_at < now() - make_interval(hours=>72)) overdue_items
  from public.gear group by workspace_id
), borrower_counts as (
  select workspace_id, count(*) filter(where deleted_at is null) borrowers_total
  from public.students group by workspace_id
), tx_counts as (
  select workspace_id, count(*) filter(where action_time>=now()-interval '7 days') transactions_7d
  from public.gear_logs group by workspace_id
)
select w.id workspace_id, w.name workspace_name,
  coalesce(g.gear_total,0) gear_total, coalesce(b.borrowers_total,0) borrowers_total,
  coalesce(g.active_checkouts,0) active_checkouts, coalesce(g.overdue_items,0) overdue_items,
  coalesce(t.transactions_7d,0) transactions_7d,
  now() computed_at
from public.workspaces w
left join gear_counts g on g.workspace_id=w.id
left join borrower_counts b on b.workspace_id=w.id
left join tx_counts t on t.workspace_id=w.id;
create unique index super_reporting_workspace_metrics_workspace_idx on public.super_reporting_workspace_metrics(workspace_id);

create table if not exists public.rate_limits_prelogin(rate_key text not null,scope text not null,window_start timestamptz not null default now(),count integer not null default 0,primary key(rate_key,scope,window_start),constraint rate_limits_prelogin_count_nonnegative check(count>=0));
create index if not exists idx_rate_limits_lookup on public.rate_limits(workspace_id,actor_id,scope,window_start desc);
create index if not exists idx_rate_limits_prelogin_lookup on public.rate_limits_prelogin(rate_key,scope,window_start desc);
create or replace function public.consume_rate_limit(p_scope text,p_limit integer,p_window_seconds integer) returns table(allowed boolean,retry_after_seconds integer) language plpgsql security definer set search_path='' as $$
declare n timestamptz:=now(); actor uuid:=auth.uid(); workspace uuid:=coalesce(public.current_workspace_id(),actor); seconds integer:=greatest(coalesce(p_window_seconds,0),1); maximum integer:=greatest(coalesce(p_limit,0),1); bucket timestamptz:=timestamptz 'epoch'+floor(extract(epoch from n)/seconds)*seconds*interval '1 second'; next_count integer;
begin if actor is null then raise exception 'Unauthorized'; end if; delete from public.rate_limits where workspace_id=workspace and actor_id=actor and scope=trim(p_scope) and window_start<n-make_interval(secs=>seconds); insert into public.rate_limits(workspace_id,actor_id,scope,window_start,count) values(workspace,actor,trim(p_scope),bucket,1) on conflict(workspace_id,actor_id,scope,window_start) do update set count=public.rate_limits.count+1 where public.rate_limits.count<maximum returning count into next_count; if not found then return query select false,greatest(ceil(extract(epoch from bucket+make_interval(secs=>seconds)-n))::integer,0);else return query select true,null::integer;end if;end $$;
create or replace function public.consume_rate_limit_prelogin(p_key text,p_scope text,p_limit integer,p_window_seconds integer) returns table(allowed boolean,retry_after_seconds integer) language plpgsql security definer set search_path='' as $$
declare n timestamptz:=now(); seconds integer:=greatest(coalesce(p_window_seconds,0),1); maximum integer:=greatest(coalesce(p_limit,0),1); bucket timestamptz:=timestamptz 'epoch'+floor(extract(epoch from n)/seconds)*seconds*interval '1 second'; next_count integer;
begin delete from public.rate_limits_prelogin where rate_key=trim(p_key) and scope=trim(p_scope) and window_start<n-make_interval(secs=>seconds); insert into public.rate_limits_prelogin(rate_key,scope,window_start,count) values(trim(p_key),trim(p_scope),bucket,1) on conflict(rate_key,scope,window_start) do update set count=public.rate_limits_prelogin.count+1 where public.rate_limits_prelogin.count<maximum returning count into next_count; if not found then return query select false,greatest(ceil(extract(epoch from bucket+make_interval(secs=>seconds)-n))::integer,0);else return query select true,null::integer;end if;end $$;

-- Explicit Data API grants; Supabase is moving new tables to opt-in exposure.
grant usage on schema public to anon, authenticated, service_role;
grant select on public.workspaces, public.profiles, public.gear, public.students,
  public.gear_logs, public.gear_status_history, public.workspace_policies,
  public.workspace_security_controls, public.admin_audit_logs,
  public.account_sessions, public.gear_access_grants, public.borrower_access_grants
  to authenticated;
grant insert, update, delete on public.gear, public.students, public.gear_status_history,
  public.workspace_policies, public.admin_audit_logs, public.gear_access_grants,
  public.borrower_access_grants to authenticated;
grant all on public.workspaces, public.profiles, public.gear, public.students,
  public.gear_logs, public.gear_status_history, public.workspace_policies,
  public.workspace_security_controls, public.admin_audit_logs,
  public.account_sessions, public.gear_access_grants, public.borrower_access_grants
  to service_role;

revoke all on function public.current_user_role() from public, anon;
revoke all on function public.current_workspace_id() from public, anon;
revoke all on function private.current_account_session_is_active() from public, anon, authenticated;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.current_workspace_id() to authenticated, service_role;
grant execute on function private.current_account_session_is_active() to authenticated, service_role;
revoke all on function private.current_profile_can_access_gear(uuid,text) from public, anon, authenticated;
revoke all on function private.current_profile_can_access_borrower(uuid,text) from public, anon, authenticated;
revoke all on function private.gear_is_in_current_workspace(uuid) from public, anon, authenticated;
revoke all on function private.borrower_is_in_current_workspace(uuid) from public, anon, authenticated;
grant execute on function private.current_profile_can_access_gear(uuid,text) to authenticated, service_role;
grant execute on function private.current_profile_can_access_borrower(uuid,text) to authenticated, service_role;
grant execute on function private.gear_is_in_current_workspace(uuid) to authenticated, service_role;
grant execute on function private.borrower_is_in_current_workspace(uuid) to authenticated, service_role;
revoke all on function public.resolve_public_workspace_by_slug(text) from public;
revoke all on function public.resolve_public_workspace_by_id(uuid) from public;
grant execute on function public.resolve_public_workspace_by_slug(text) to anon, authenticated, service_role;
grant execute on function public.resolve_public_workspace_by_id(uuid) to anon, authenticated, service_role;
revoke all on function public.create_borrower_identity(uuid,text,text,text,uuid[]) from public, anon;
grant execute on function public.create_borrower_identity(uuid,text,text,text,uuid[]) to authenticated, service_role;
revoke all on function public.workspace_account_dashboard() from public, anon;
grant execute on function public.workspace_account_dashboard() to authenticated, service_role;
revoke all on table public.rate_limits_prelogin from public, anon, authenticated;
grant all on table public.rate_limits_prelogin to service_role;
revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon;
grant execute on function public.consume_rate_limit(text,integer,integer) to authenticated,service_role;
revoke all on function public.consume_rate_limit_prelogin(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit_prelogin(text,text,integer,integer) to service_role;

-- The primary admin FK is installed last because profiles may have been created
-- as part of the empty-staging path.
alter table public.workspaces drop constraint if exists tenants_primary_admin_profile_id_fkey;
alter table public.workspaces drop constraint if exists workspaces_primary_admin_profile_id_fkey;
alter table public.workspaces add constraint workspaces_primary_admin_profile_id_fkey
  foreign key(primary_admin_profile_id) references public.profiles(id) on delete set null;

commit;
