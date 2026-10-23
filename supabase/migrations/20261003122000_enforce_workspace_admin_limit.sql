begin;

-- Create a workspace-admin profile while holding the workspace row lock so
-- concurrent invitations cannot pass the same seat-count check.
create or replace function public.workspace_admin_create_profile(
  p_actor_profile_id uuid,
  p_workspace_id uuid,
  p_profile_id uuid,
  p_auth_email text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_status text;
  v_workspace_archived_at timestamptz;
  v_primary_admin_profile_id uuid;
  v_max_admins integer;
  v_actor_workspace_id uuid;
  v_actor_role text;
  v_actor_is_active boolean;
  v_admin_count integer;
begin
  select w.status, w.archived_at, w.primary_admin_profile_id, policy.max_admins
    into v_workspace_status, v_workspace_archived_at,
         v_primary_admin_profile_id, v_max_admins
  from public.workspaces as w
  left join public.workspace_policies as policy
    on policy.workspace_id = w.id
  where w.id = p_workspace_id
  for update of w;

  if not found or v_workspace_archived_at is not null or v_workspace_status is distinct from 'active' then
    raise exception 'workspace is unavailable';
  end if;

  select profile.workspace_id, profile.role, profile.is_active
    into v_actor_workspace_id, v_actor_role, v_actor_is_active
  from public.profiles as profile
  where profile.id = p_actor_profile_id
    and profile.deleted_at is null
  for update;

  if not found
     or v_actor_workspace_id is distinct from p_workspace_id
     or v_actor_role is distinct from 'workspace_admin'
     or v_actor_is_active is not true
     or v_primary_admin_profile_id is distinct from p_actor_profile_id then
    raise exception 'active primary workspace admin access required';
  end if;

  select count(*)::integer into v_admin_count
  from public.profiles as profile
  where profile.workspace_id = p_workspace_id
    and profile.role = 'workspace_admin'
    and profile.deleted_at is null;

  if v_max_admins is not null and v_admin_count >= v_max_admins then
    raise exception 'workspace administrator limit reached';
  end if;

  insert into public.profiles(id, workspace_id, auth_email, role, is_active)
  values (p_profile_id, p_workspace_id, p_auth_email, 'workspace_admin', true);

  return p_profile_id;
end;
$$;

revoke all on function public.workspace_admin_create_profile(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.workspace_admin_create_profile(uuid, uuid, uuid, text)
  to service_role;

-- Apply the same cap to tenant-account promotions in the existing atomic role
-- and membership update. The workspace row lock serializes this path with
-- workspace_admin_create_profile above.
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
  v_max_admins integer;
  v_organization_id text;
  v_actor_workspace_id uuid;
  v_actor_role text;
  v_actor_is_active boolean;
  v_target_role text;
  v_better_auth_user_id text;
  v_membership_role text;
  v_updated_memberships integer;
  v_admin_count integer;
begin
  if p_role is null or p_role not in ('tenant_account', 'workspace_admin') then
    raise exception 'invalid workspace account role';
  end if;

  select w.status, w.archived_at, w.primary_admin_profile_id,
         w.better_auth_organization_id, policy.max_admins
    into v_workspace_status, v_workspace_archived_at,
         v_primary_admin_profile_id, v_organization_id, v_max_admins
  from public.workspaces as w
  left join public.workspace_policies as policy
    on policy.workspace_id = w.id
  where w.id = p_workspace_id
  for update of w;

  if not found or v_workspace_archived_at is not null or v_workspace_status is distinct from 'active' then
    raise exception 'workspace is unavailable';
  end if;

  select profile.workspace_id, profile.role, profile.is_active
    into v_actor_workspace_id, v_actor_role, v_actor_is_active
  from public.profiles as profile
  where profile.id = p_actor_profile_id
    and profile.deleted_at is null
  for update;

  if not found
     or v_actor_workspace_id is distinct from p_workspace_id
     or v_actor_role is distinct from 'workspace_admin'
     or v_actor_is_active is not true then
    raise exception 'active workspace admin access required';
  end if;

  select profile.role, profile.better_auth_user_id
    into v_target_role, v_better_auth_user_id
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.workspace_id = p_workspace_id
    and profile.deleted_at is null
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
  if v_target_role = 'workspace_admin'
     and p_role = 'tenant_account'
     and p_actor_profile_id is distinct from v_primary_admin_profile_id then
    raise exception 'primary workspace admin access required to demote an admin';
  end if;

  if v_target_role = p_role then
    return;
  end if;

  if v_target_role <> 'workspace_admin' and p_role = 'workspace_admin' then
    select count(*)::integer into v_admin_count
    from public.profiles as profile
    where profile.workspace_id = p_workspace_id
      and profile.role = 'workspace_admin'
      and profile.deleted_at is null;

    if v_max_admins is not null and v_admin_count >= v_max_admins then
      raise exception 'workspace administrator limit reached';
    end if;
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
