-- Remove a workspace profile's Better Auth link and user in one transaction.
-- The profile FK is RESTRICT, so deleting the auth user first makes the purge
-- fail. Keeping both operations atomic also makes retries safe if a later
-- external cleanup step fails.
begin;

create or replace function public.purge_workspace_better_auth_user(
  p_workspace_id uuid,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace public.workspaces%rowtype;
  v_better_auth_user_id text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_profile_id is null then
    raise exception 'Invalid workspace purge user input' using errcode = '22023';
  end if;

  select * into v_workspace
  from public.workspaces
  where id = p_workspace_id
  for update;
  if not found then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  if v_workspace.purge_state <> 'purging'
     or v_workspace.archived_at is null
     or v_workspace.purge_after is null
     or v_workspace.purge_after > pg_catalog.clock_timestamp() then
    raise exception 'Workspace is not due for purge' using errcode = '42501';
  end if;

  select profile.better_auth_user_id into v_better_auth_user_id
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.workspace_id = v_workspace.id
  for update;
  if not found then
    raise exception 'Workspace profile does not exist' using errcode = 'P0002';
  end if;

  update public.profiles
  set better_auth_user_id = null
  where id = p_profile_id
    and workspace_id = v_workspace.id;

  if v_better_auth_user_id is not null then
    delete from better_auth."user"
    where id = v_better_auth_user_id;
  end if;
end;
$$;

revoke all on function public.purge_workspace_better_auth_user(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_better_auth_user(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
