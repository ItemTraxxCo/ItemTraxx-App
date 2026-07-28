-- Provisions sales_leads / customer_status_logs on environments where they were
-- never created (they originally shipped via an untracked ad-hoc script applied
-- only to prod). Idempotent: no-op where the tables already exist.

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  plan text not null check (
    plan in (
      'workspace_core',
      'workspace_growth',
      'workspace_enterprise',
      'education',
      'custom',
      'individual_yearly',
      'individual_monthly',
      'other'
    )
  ),
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
  organization text null,
  reply_email text not null,
  details text null,
  source text not null default 'pricing_page',
  ip_hash text null,
  user_agent text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz null
);

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

-- Step-up MFA gating (has_recent_privileged_step_up) isn't provisioned on every
-- environment yet. Use the stricter step-up-gated policy where the function
-- exists (prod); fall back to a role-only check where it doesn't (staging).
do $$
declare
  has_step_up boolean := to_regprocedure('public.has_recent_privileged_step_up(text)') is not null;
begin
  execute 'drop policy if exists "super_admin_select_sales_leads" on public.sales_leads';
  if has_step_up then
    execute $sql$
      create policy "super_admin_select_sales_leads"
        on public.sales_leads
        for select
        to authenticated
        using (
          (
            exists (
              select 1
              from public.profiles p
              where p.id = (select auth.uid())
                and p.is_active = true
                and p.role = 'super_admin'
            )
          )
          and (select public.has_recent_privileged_step_up('super_admin'))
        )
    $sql$;
  else
    execute $sql$
      create policy "super_admin_select_sales_leads"
        on public.sales_leads
        for select
        to authenticated
        using (
          exists (
            select 1
            from public.profiles p
            where p.id = (select auth.uid())
              and p.is_active = true
              and p.role = 'super_admin'
          )
        )
    $sql$;
  end if;

  execute 'drop policy if exists "super_admin_select_customer_status_logs" on public.customer_status_logs';
  if has_step_up then
    execute $sql$
      create policy "super_admin_select_customer_status_logs"
        on public.customer_status_logs
        for select
        to authenticated
        using (
          (
            exists (
              select 1
              from public.profiles p
              where p.id = (select auth.uid())
                and p.is_active = true
                and p.role = 'super_admin'
            )
          )
          and (select public.has_recent_privileged_step_up('super_admin'))
        )
    $sql$;
  else
    execute $sql$
      create policy "super_admin_select_customer_status_logs"
        on public.customer_status_logs
        for select
        to authenticated
        using (
          exists (
            select 1
            from public.profiles p
            where p.id = (select auth.uid())
              and p.is_active = true
              and p.role = 'super_admin'
          )
        )
    $sql$;
  end if;
end $$;
