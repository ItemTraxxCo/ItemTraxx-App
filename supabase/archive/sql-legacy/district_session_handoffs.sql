create table if not exists public.district_session_handoffs (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  user_id uuid not null,
  district_slug text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_district_session_handoffs_expires_at
  on public.district_session_handoffs (expires_at);

create index if not exists idx_district_session_handoffs_user_id
  on public.district_session_handoffs (user_id);

alter table if exists public.district_session_handoffs enable row level security;

drop policy if exists "deny_all_district_session_handoffs" on public.district_session_handoffs;
create policy "deny_all_district_session_handoffs"
  on public.district_session_handoffs
  for all
  using (false)
  with check (false);
