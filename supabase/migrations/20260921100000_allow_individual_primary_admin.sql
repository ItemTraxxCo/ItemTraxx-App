-- Individual Accounts use their individual_account profile as the private
-- workspace primary admin. Keep the existing primary-admin integrity checks
-- while allowing that dedicated role alongside Workspace Admins.
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
      and p.role in ('workspace_admin', 'individual_account')
      and p.is_active
      and p.deleted_at is null
  ) then
    raise exception 'Primary account profile must be active in the same workspace'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
