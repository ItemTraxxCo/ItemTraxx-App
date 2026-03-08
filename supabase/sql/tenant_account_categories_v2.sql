alter table public.tenant_policies
  drop constraint if exists tenant_policies_account_category_check;

alter table public.tenant_policies
  add constraint tenant_policies_account_category_check
  check (account_category in ('organization', 'district', 'individual'));

alter table public.tenant_policies
  drop constraint if exists tenant_policies_plan_code_check;

alter table public.tenant_policies
  add constraint tenant_policies_plan_code_check
  check (
    plan_code in (
      'core',
      'growth',
      'starter',
      'scale',
      'enterprise',
      'individual_yearly',
      'individual_monthly'
    )
    or plan_code is null
  );
