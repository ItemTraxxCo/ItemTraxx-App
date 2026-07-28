-- Align sales_leads.plan values with the current public pricing tiers
-- (Workspace Core/Growth/Enterprise, Education, Custom, Individual Yearly/Monthly, Other).
-- District/Organization plan tiers were merged into a single Workspace lineup.

alter table public.sales_leads
  drop constraint if exists sales_leads_plan_check;

update public.sales_leads
set plan = case plan
  when 'district_core' then 'workspace_core'
  when 'organization_starter' then 'workspace_core'
  when 'district_growth' then 'workspace_growth'
  when 'organization_scale' then 'workspace_growth'
  when 'district_enterprise' then 'workspace_enterprise'
  when 'organization_enterprise' then 'workspace_enterprise'
  else plan
end
where plan in (
  'district_core', 'organization_starter',
  'district_growth', 'organization_scale',
  'district_enterprise', 'organization_enterprise'
);

alter table public.sales_leads
  add constraint sales_leads_plan_check
  check (
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
  );
