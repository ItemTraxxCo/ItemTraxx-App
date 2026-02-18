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
