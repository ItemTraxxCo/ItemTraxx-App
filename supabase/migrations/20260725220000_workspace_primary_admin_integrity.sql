begin;

create or replace function private.validate_workspace_primary_admin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.primary_admin_profile_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new.primary_admin_profile_id
      and p.workspace_id = new.id
      and p.role = 'workspace_admin'
      and p.is_active
      and p.deleted_at is null
  ) then
    raise exception 'Primary Workspace Admin must be an active Workspace Admin in the same workspace'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_workspace_primary_admin() from public, anon, authenticated;
drop trigger if exists workspaces_validate_primary_admin on public.workspaces;
create trigger workspaces_validate_primary_admin
before insert or update of primary_admin_profile_id on public.workspaces
for each row execute function private.validate_workspace_primary_admin();

commit;
