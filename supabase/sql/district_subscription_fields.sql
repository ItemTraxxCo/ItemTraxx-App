alter table if exists public.districts
  add column if not exists subscription_plan text;

alter table if exists public.districts
  add column if not exists billing_status text;

alter table if exists public.districts
  add column if not exists renewal_date date;

alter table if exists public.districts
  add column if not exists billing_email text;

alter table if exists public.districts
  add column if not exists invoice_reference text;

alter table if exists public.districts
  drop constraint if exists districts_subscription_plan_check;

alter table if exists public.districts
  add constraint districts_subscription_plan_check
  check (
    subscription_plan in (
      'district_core',
      'district_growth',
      'district_enterprise',
      'organization_starter',
      'organization_scale',
      'organization_enterprise'
    )
    or subscription_plan is null
  );

alter table if exists public.districts
  drop constraint if exists districts_billing_status_check;

alter table if exists public.districts
  add constraint districts_billing_status_check
  check (billing_status in ('draft', 'active', 'past_due', 'canceled') or billing_status is null);
