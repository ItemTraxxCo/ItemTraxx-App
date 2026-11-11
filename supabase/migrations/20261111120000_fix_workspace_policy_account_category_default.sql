-- 20260728211049_rename_workspace_policy_plan_keys remapped the legacy
-- 'organization' category to 'workspace' and replaced the check constraint,
-- but left the column default at 'organization'. Any insert that relied on the
-- default therefore failed workspace_policies_account_category_check.
alter table public.workspace_policies
  alter column account_category set default 'workspace';
