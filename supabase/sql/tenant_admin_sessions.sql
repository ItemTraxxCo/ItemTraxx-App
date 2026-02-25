create table if not exists public.tenant_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  device_label text null,
  user_agent text null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by uuid null references public.profiles(id) on delete set null
);

create index if not exists tenant_admin_sessions_tenant_profile_active_idx
  on public.tenant_admin_sessions (tenant_id, profile_id, last_seen_at desc)
  where revoked_at is null;

create index if not exists tenant_admin_sessions_device_active_idx
  on public.tenant_admin_sessions (tenant_id, profile_id, device_id)
  where revoked_at is null;

alter table public.tenant_admin_sessions enable row level security;

drop policy if exists "tenant_admin_sessions_select_own" on public.tenant_admin_sessions;
create policy "tenant_admin_sessions_select_own"
  on public.tenant_admin_sessions
  for select
  to authenticated
  using (
    auth.uid() = profile_id
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'tenant_admin'
    )
  );
