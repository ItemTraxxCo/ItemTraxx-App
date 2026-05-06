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
  on public.super_admin_sessions (profile_id, last_seen_at desc)
  where revoked_at is null;

create index if not exists super_admin_sessions_device_active_idx
  on public.super_admin_sessions (profile_id, device_id)
  where revoked_at is null;

create index if not exists super_admin_sessions_auth_session_revoked_idx
  on public.super_admin_sessions (profile_id, auth_session_id, revoked_at desc)
  where auth_session_id is not null and revoked_at is not null;

alter table public.super_admin_sessions enable row level security;

drop policy if exists "super_admin_sessions_select_own" on public.super_admin_sessions;
create policy "super_admin_sessions_select_own"
  on public.super_admin_sessions
  for select
  to authenticated
  using (
    auth.uid() = profile_id
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'super_admin'
    )
  );
