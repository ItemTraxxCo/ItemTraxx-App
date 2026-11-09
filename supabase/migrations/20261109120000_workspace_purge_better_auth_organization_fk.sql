-- The workspace purge executor deletes the Better Auth organization before
-- purge_workspace_data runs, so a failed external step leaves the workspace
-- claimable for retry. The RESTRICT link from public.workspaces rejected
-- that delete, so every due workspace with an organization failed and went
-- back to grace on each worker run.
--
-- Clear the link when the organization is deleted, and keep the RESTRICT
-- behavior with a trigger for every workspace that is not being purged.
-- (Profile/better_auth.user links already go through
-- purge_workspace_better_auth_user, which clears the link before deleting,
-- so that foreign key stays RESTRICT and needs no trigger.)

begin;

create or replace function private.guard_linked_better_auth_organization_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.workspaces as w
    where w.better_auth_organization_id = old.id
      and w.purge_state is distinct from 'purging'
  ) then
    raise exception 'Better Auth organization is linked to an ItemTraxx workspace'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

revoke all on function private.guard_linked_better_auth_organization_delete() from public, anon, authenticated;

drop trigger if exists guard_linked_workspace_delete on better_auth.organization;
create trigger guard_linked_workspace_delete
before delete on better_auth.organization
for each row execute function private.guard_linked_better_auth_organization_delete();

do $$
declare
  fk_name text;
begin
  for fk_name in
    select con.conname
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.workspaces'::regclass
      and con.contype = 'f'
      and con.confrelid = 'better_auth.organization'::regclass
  loop
    execute pg_catalog.format('alter table public.workspaces drop constraint %I', fk_name);
  end loop;
end;
$$;

alter table public.workspaces
  add constraint workspaces_better_auth_organization_id_fkey
  foreign key (better_auth_organization_id) references better_auth.organization(id) on delete set null;

notify pgrst, 'reload schema';

commit;
