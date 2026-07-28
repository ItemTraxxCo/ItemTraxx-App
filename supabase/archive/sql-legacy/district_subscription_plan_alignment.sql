alter table if exists public.districts
  drop constraint if exists districts_subscription_plan_check;

update public.districts
set subscription_plan = case subscription_plan
  when 'core' then 'district_core'
  when 'growth' then 'district_growth'
  when 'starter' then 'district_core'
  when 'standard' then 'district_growth'
  when 'enterprise' then 'district_enterprise'
  else subscription_plan
end
where subscription_plan in ('core', 'growth', 'starter', 'standard', 'enterprise');

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
