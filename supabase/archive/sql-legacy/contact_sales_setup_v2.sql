alter table public.sales_leads
  drop constraint if exists sales_leads_plan_check;

alter table public.sales_leads
  add constraint sales_leads_plan_check
  check (
    plan in (
      'district_core',
      'district_growth',
      'district_enterprise',
      'organization_starter',
      'organization_scale',
      'organization_enterprise',
      'individual_yearly',
      'individual_monthly',
      'other'
    )
  );
