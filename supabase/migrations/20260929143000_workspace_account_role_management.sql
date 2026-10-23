begin;

create or replace function public.workspace_admin_set_profile_role(
  p_actor_profile_id uuid,
  p_workspace_id uuid,
  p_profile_id uuid,
  p_role text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_status text;
  v_workspace_archived_at timestamptz;
  v_primary_admin_profile_id uuid;
  v_organization_id text;
  v_actor_workspace_id uuid;
  v_actor_role text;
  v_actor_is_active boolean;
  v_target_role text;
  v_better_auth_user_id text;
  v_membership_role text;
  v_updated_memberships integer;
begin
  if p_role is null or p_role not in ('tenant_account', 'workspace_admin') then
    raise exception 'invalid workspace account role';
  end if;

  select w.status, w.archived_at, w.primary_admin_profile_id,
         w.better_auth_organization_id
    into v_workspace_status, v_workspace_archived_at,
         v_primary_admin_profile_id, v_organization_id
  from public.workspaces w
  where w.id = p_workspace_id
  for update;

  if not found or v_workspace_archived_at is not null or v_workspace_status is distinct from 'active' then
    raise exception 'workspace is unavailable';
  end if;

  select p.workspace_id, p.role, p.is_active
    into v_actor_workspace_id, v_actor_role, v_actor_is_active
  from public.profiles p
  where p.id = p_actor_profile_id
    and p.deleted_at is null
  for update;

  if not found
     or v_actor_workspace_id is distinct from p_workspace_id
     or v_actor_role is distinct from 'workspace_admin'
     or v_actor_is_active is not true then
    raise exception 'active workspace admin access required';
  end if;

  select p.role, p.better_auth_user_id
    into v_target_role, v_better_auth_user_id
  from public.profiles p
  where p.id = p_profile_id
    and p.workspace_id = p_workspace_id
    and p.deleted_at is null
  for update;

  if not found or v_target_role not in ('tenant_account', 'workspace_admin') then
    raise exception 'workspace account not found';
  end if;
  if p_profile_id = v_primary_admin_profile_id and p_role <> 'workspace_admin' then
    raise exception 'primary admin role cannot be changed';
  end if;
  if p_profile_id = p_actor_profile_id and p_role <> 'workspace_admin' then
    raise exception 'workspace admins cannot change their own role';
  end if;

  if v_target_role = p_role then
    return;
  end if;
  if v_better_auth_user_id is null or v_organization_id is null then
    raise exception 'workspace account identity is not fully provisioned';
  end if;

  v_membership_role := case
    when p_role = 'workspace_admin' then 'admin'
    else 'tenant_account'
  end;

  update public.profiles
  set role = p_role
  where id = p_profile_id
    and workspace_id = p_workspace_id;

  update better_auth.member
  set role = v_membership_role
  where "userId" = v_better_auth_user_id
    and "organizationId" = v_organization_id;
  get diagnostics v_updated_memberships = row_count;

  if v_updated_memberships <> 1 then
    raise exception 'workspace account membership could not be synchronized';
  end if;

  insert into public.admin_audit_logs (
    workspace_id,
    actor_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_actor_profile_id,
    'set_workspace_account_role',
    'profile',
    p_profile_id,
    jsonb_build_object('previous_role', v_target_role, 'role', p_role)
  );
end;
$$;

revoke all on function public.workspace_admin_set_profile_role(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.workspace_admin_set_profile_role(uuid, uuid, uuid, text)
  to service_role;
notify pgrst, 'reload schema';

commit;
