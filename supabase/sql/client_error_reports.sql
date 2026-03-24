create extension if not exists pgcrypto;

create table if not exists public.client_error_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  message text not null,
  reason text not null,
  error_name text null,
  stack text null,
  context text null,
  page_url text null,
  environment text null,
  release text null,
  user_agent text null,
  is_authenticated boolean not null default false,
  auth_role text null,
  tenant_context_id text null,
  district_context_id text null,
  is_district_host boolean not null default false,
  district_id text null,
  request_id text null,
  client_fingerprint_hash text null,
  ip_hash text null,
  diagnostics jsonb not null default '{}'::jsonb,
  slack_notified_at timestamptz null,
  slack_delivery_error text null
);

create index if not exists client_error_reports_created_at_idx
  on public.client_error_reports (created_at desc);

create index if not exists client_error_reports_environment_idx
  on public.client_error_reports (environment);

create index if not exists client_error_reports_release_idx
  on public.client_error_reports (release);

create index if not exists client_error_reports_page_url_idx
  on public.client_error_reports (page_url);

alter table public.client_error_reports enable row level security;

drop policy if exists "deny_all_client_error_reports" on public.client_error_reports;
create policy "deny_all_client_error_reports"
  on public.client_error_reports
  for all
  to public
  using (false)
  with check (false);

drop policy if exists "super_admin_select_client_error_reports" on public.client_error_reports;
create policy "super_admin_select_client_error_reports"
  on public.client_error_reports
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
