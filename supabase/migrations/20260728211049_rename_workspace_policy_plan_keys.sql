-- Align workspace_policies.account_category/plan_code with the current public
-- pricing tiers (Workspace Core/Growth/Enterprise, Education, Custom, Individual).
-- District/Organization account categories were merged into a single Workspace
-- category; plan codes are now prefixed to match (workspace_core, etc).

alter table public.workspace_policies
  drop constraint if exists tenant_policies_account_category_check;
alter table public.workspace_policies
  drop constraint if exists workspace_policies_account_category_check;
alter table public.workspace_policies
  drop constraint if exists tenant_policies_plan_code_check;
alter table public.workspace_policies
  drop constraint if exists workspace_policies_plan_code_check;

update public.workspace_policies
set plan_code = case plan_code
  when 'core' then 'workspace_core'
  when 'starter' then 'workspace_core'
  when 'growth' then 'workspace_growth'
  when 'scale' then 'workspace_growth'
  when 'enterprise' then 'workspace_enterprise'
  else plan_code
end
where plan_code in ('core', 'starter', 'growth', 'scale', 'enterprise');

update public.workspace_policies
set account_category = 'workspace'
where account_category in ('organization', 'district');

alter table public.workspace_policies
  add constraint workspace_policies_account_category_check
  check (account_category in ('workspace', 'education', 'custom', 'individual'));

alter table public.workspace_policies
  add constraint workspace_policies_plan_code_check
  check (
    plan_code in (
      'workspace_core',
      'workspace_growth',
      'workspace_enterprise',
      'education',
      'custom',
      'individual_yearly',
      'individual_monthly'
    )
    or plan_code is null
  );
