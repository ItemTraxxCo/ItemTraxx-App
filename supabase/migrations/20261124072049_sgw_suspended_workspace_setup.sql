-- Permit initial identity setup without exposing a suspended workspace as active.
create or replace function public.better_auth_create_user(
  p_profile_id uuid,
  p_user_id text,
  p_account_id text,
  p_email text,
  p_name text,
  p_global_role text,
  p_password_hash text,
  p_workspace_id uuid default null,
  p_member_id text default null,
  p_member_role text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id text;
  v_setup_suspended boolean := false;
begin
  if p_profile_id is null or nullif(p_user_id, '') is null or nullif(p_account_id, '') is null
     or nullif(p_email, '') is null or nullif(p_password_hash, '') is null then
    raise exception 'invalid user input';
  end if;
  if p_global_role not in ('user', 'super_admin') then raise exception 'invalid global role'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and deleted_at is null) then
    raise exception 'profile not found';
  end if;

  insert into better_auth."user"(id, name, email, "emailVerified", "createdAt", "updatedAt", role)
  values (p_user_id, coalesce(nullif(trim(p_name), ''), lower(trim(p_email))), lower(trim(p_email)), true, now(), now(), p_global_role);
  insert into better_auth.account(id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
  values (p_account_id, p_user_id, 'credential', p_user_id, p_password_hash, now(), now());

  if p_workspace_id is not null then
    if p_member_role not in ('tenant_account', 'workspace_admin', 'individual_account') or nullif(p_member_id, '') is null then
      raise exception 'invalid membership input';
    end if;
    select better_auth_organization_id into v_organization_id
    from public.workspaces where id = p_workspace_id and archived_at is null;
    if v_organization_id is null then raise exception 'workspace organization missing'; end if;
    -- The normal membership trigger requires an active workspace. For initial
    -- trusted setup only, hold the workspace row lock and temporarily activate
    -- it inside this transaction; other transactions still see it suspended.
    if p_member_role in ('workspace_admin', 'individual_account') then
      update public.workspaces set status = 'active'
      where id = p_workspace_id and status = 'suspended'
        and archived_at is null and primary_admin_profile_id is null;
      v_setup_suspended := found;
    end if;
    insert into better_auth.member(id, "organizationId", "userId", role, "createdAt")
    values (p_member_id, v_organization_id, p_user_id,
      case when p_member_role = 'workspace_admin' then 'admin' else p_member_role end, now());
    if v_setup_suspended then
      update public.workspaces set status = 'suspended' where id = p_workspace_id;
    end if;
  end if;

  update public.profiles
  set better_auth_user_id = p_user_id, auth_email = lower(trim(p_email))
  where id = p_profile_id;
  return p_user_id;
end;
$$;

revoke all on function public.better_auth_create_user(uuid, text, text, text, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.better_auth_create_user(uuid, text, text, text, text, text, text, uuid, text, text) to service_role;
