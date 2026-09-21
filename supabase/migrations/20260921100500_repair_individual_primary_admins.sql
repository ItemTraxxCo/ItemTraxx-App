-- Individual accounts created before the primary-admin integrity trigger
-- accepted their dedicated role can have a valid profile but no workspace
-- pointer. Repair only workspaces with exactly one active individual profile.
update public.workspaces w
set primary_admin_profile_id = p.id
from public.profiles p
cross join public.workspace_policies wp
where w.primary_admin_profile_id is null
  and wp.account_category = 'individual'
  and p.workspace_id = w.id
  and p.role = 'individual_account'
  and p.is_active
  and p.deleted_at is null
  and not exists (
    select 1
    from public.profiles other
    where other.workspace_id = p.workspace_id
      and other.id <> p.id
      and other.role = 'individual_account'
      and other.is_active
      and other.deleted_at is null
  );
