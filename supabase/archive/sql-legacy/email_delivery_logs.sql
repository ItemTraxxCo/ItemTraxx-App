create extension if not exists pgcrypto;

create table if not exists public.email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz null,
  email_type text not null,
  recipient_email text not null,
  subject text not null,
  provider text not null default 'resend',
  provider_message_id text null,
  status text not null check (status in ('queued', 'sent', 'failed')),
  error_message text null,
  request_context jsonb null,
  triggered_by_user_id uuid null references auth.users (id) on delete set null,
  job_id uuid null references public.async_jobs (id) on delete set null,
  tenant_id uuid null references public.tenants (id) on delete set null,
  district_id uuid null references public.districts (id) on delete set null,
  metadata jsonb null
);

create index if not exists email_delivery_logs_created_at_idx
  on public.email_delivery_logs (created_at desc);

create index if not exists email_delivery_logs_email_type_idx
  on public.email_delivery_logs (email_type);

create index if not exists email_delivery_logs_status_idx
  on public.email_delivery_logs (status);

create index if not exists email_delivery_logs_recipient_idx
  on public.email_delivery_logs (recipient_email);

create index if not exists email_delivery_logs_triggered_by_user_idx
  on public.email_delivery_logs (triggered_by_user_id);

alter table public.email_delivery_logs enable row level security;
