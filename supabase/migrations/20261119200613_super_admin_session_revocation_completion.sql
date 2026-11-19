alter table public.super_admin_sessions
  add column if not exists better_auth_revocation_completed_at timestamptz;

comment on column public.super_admin_sessions.better_auth_revocation_completed_at is
  'Time the matching Better Auth session deletion was confirmed; null means not confirmed.';
