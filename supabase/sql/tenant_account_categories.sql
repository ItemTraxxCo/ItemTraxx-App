alter table if exists public.tenant_policies
  add column if not exists account_category text not null default 'organization';

alter table if exists public.tenant_policies
  add column if not exists plan_code text null;

alter table if exists public.tenant_policies
  drop constraint if exists tenant_policies_account_category_check;

alter table if exists public.tenant_policies
  add constraint tenant_policies_account_category_check
  check (account_category in ('organization', 'individual'));

alter table if exists public.tenant_policies
  drop constraint if exists tenant_policies_plan_code_check;

alter table if exists public.tenant_policies
  add constraint tenant_policies_plan_code_check
  check (
    plan_code in (
      'starter',
      'scale',
      'enterprise',
      'individual_yearly',
      'individual_monthly'
    )
    or plan_code is null
  );

update public.tenant_policies
set account_category = coalesce(account_category, 'organization')
where account_category is null;
