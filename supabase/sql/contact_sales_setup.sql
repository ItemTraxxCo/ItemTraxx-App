create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  plan text not null check (plan in ('core', 'growth', 'enterprise')),
  lead_state text not null default 'open' check (
    lead_state in ('open', 'closed', 'converted_to_customer')
  ),
  stage text not null default 'waiting_for_quote' check (
    stage in (
      'waiting_for_quote',
      'quote_generated',
      'quote_sent',
      'quote_converted_to_invoice',
      'invoice_sent',
      'invoice_paid'
    )
  ),
  schools_count integer null check (schools_count is null or schools_count > 0),
  name text not null,
  organization text not null,
  reply_email text not null,
  details text null,
  source text not null default 'pricing_page',
  ip_hash text null,
  user_agent text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz null
);

alter table public.sales_leads
  add column if not exists lead_state text;
alter table public.sales_leads
  alter column lead_state set default 'open';
update public.sales_leads
set lead_state = 'open'
where lead_state is null;
alter table public.sales_leads
  alter column lead_state set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_leads_lead_state_check'
  ) then
    alter table public.sales_leads
      add constraint sales_leads_lead_state_check check (
        lead_state in ('open', 'closed', 'converted_to_customer')
      );
  end if;
end $$;

alter table public.sales_leads
  add column if not exists stage text;
alter table public.sales_leads
  alter column stage set default 'waiting_for_quote';
update public.sales_leads
set stage = 'waiting_for_quote'
where stage is null;
alter table public.sales_leads
  alter column stage set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_leads_stage_check'
  ) then
    alter table public.sales_leads
      add constraint sales_leads_stage_check check (
        stage in (
          'waiting_for_quote',
          'quote_generated',
          'quote_sent',
          'quote_converted_to_invoice',
          'invoice_sent',
          'invoice_paid'
        )
      );
  end if;
end $$;

alter table public.sales_leads
  add column if not exists updated_at timestamptz null;

create index if not exists sales_leads_created_at_idx on public.sales_leads (created_at desc);
create index if not exists sales_leads_plan_idx on public.sales_leads (plan);
create index if not exists sales_leads_stage_idx on public.sales_leads (stage);

create table if not exists public.customer_status_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  invoice_id text not null,
  status text not null check (
    status in ('paid_on_time', 'paid_late', 'awaiting_payment', 'canceling')
  ),
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(id) on delete set null
);

create index if not exists customer_status_logs_lead_created_idx
  on public.customer_status_logs (lead_id, created_at desc);

alter table public.sales_leads enable row level security;
alter table public.customer_status_logs enable row level security;

drop policy if exists "super_admin_select_sales_leads" on public.sales_leads;
create policy "super_admin_select_sales_leads"
  on public.sales_leads
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

drop policy if exists "super_admin_select_customer_status_logs" on public.customer_status_logs;
create policy "super_admin_select_customer_status_logs"
  on public.customer_status_logs
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
