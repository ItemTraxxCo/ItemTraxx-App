delete from public.district_session_handoffs;

alter table if exists public.district_session_handoffs
  drop column if exists password;

alter table if exists public.district_session_handoffs
  alter column access_token set not null;

alter table if exists public.district_session_handoffs
  alter column refresh_token set not null;
