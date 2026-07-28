alter table if exists public.district_session_handoffs
  add column if not exists auth_email text;

alter table if exists public.district_session_handoffs
  add column if not exists password text;

alter table if exists public.district_session_handoffs
  alter column access_token drop not null;

alter table if exists public.district_session_handoffs
  alter column refresh_token drop not null;
