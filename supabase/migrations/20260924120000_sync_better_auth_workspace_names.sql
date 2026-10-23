-- Better Auth remains the source of truth for an organization's name. Keep the
-- workspace projection in sync in the same transaction as Better Auth updates.
create or replace function public.sync_workspace_name_from_better_auth_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workspaces
  set name = new.name
  where better_auth_organization_id = new.id;

  return new;
end;
$$;

revoke all on function public.sync_workspace_name_from_better_auth_organization()
  from public, anon, authenticated;
grant execute on function public.sync_workspace_name_from_better_auth_organization()
  to postgres, service_role;

drop trigger if exists sync_workspace_name_from_better_auth_organization
  on better_auth.organization;

create trigger sync_workspace_name_from_better_auth_organization
after update of name on better_auth.organization
for each row
when (old.name is distinct from new.name)
execute function public.sync_workspace_name_from_better_auth_organization();

-- Reconcile existing workspace projections to Better Auth's current names.
update public.workspaces as workspace
set name = organization.name
from better_auth.organization as organization
where workspace.better_auth_organization_id = organization.id
  and workspace.name is distinct from organization.name;
