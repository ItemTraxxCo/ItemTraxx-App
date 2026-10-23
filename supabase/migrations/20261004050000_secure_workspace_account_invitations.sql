begin;

create table if not exists public.workspace_account_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  inviter_profile_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  account_role text not null check (account_role in ('tenant_account', 'workspace_admin')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_profile_id uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  constraint workspace_account_invitations_email_normalized
    check (email <> '' and email = lower(trim(email))),
  constraint workspace_account_invitations_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint workspace_account_invitations_expiry
    check (expires_at > created_at)
);

alter table public.workspace_account_invitations enable row level security;
revoke all on public.workspace_account_invitations from public, anon, authenticated;
grant select, insert, update, delete on public.workspace_account_invitations to service_role;

create unique index if not exists workspace_account_invitations_one_pending_per_email
  on public.workspace_account_invitations (workspace_id, lower(email))
  where accepted_at is null and revoked_at is null;
create index if not exists workspace_account_invitations_expiry_idx
  on public.workspace_account_invitations (expires_at);

create table if not exists public.better_auth_email_change_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  better_auth_user_id text not null,
  current_email text not null,
  new_email text not null,
  approval_token_hash text not null unique,
  verification_token_hash text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  current_email_approved_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  constraint better_auth_email_change_emails_normalized
    check (
      current_email <> '' and current_email = lower(trim(current_email))
      and new_email <> '' and new_email = lower(trim(new_email))
      and current_email <> new_email
    ),
  constraint better_auth_email_change_approval_token_format
    check (approval_token_hash ~ '^[0-9a-f]{64}$'),
  constraint better_auth_email_change_verification_token_format
    check (verification_token_hash is null or verification_token_hash ~ '^[0-9a-f]{64}$'),
  constraint better_auth_email_change_expiry
    check (expires_at > created_at)
);

alter table public.better_auth_email_change_requests enable row level security;
revoke all on public.better_auth_email_change_requests from public, anon, authenticated;
grant select, insert, update, delete on public.better_auth_email_change_requests to service_role;

create unique index if not exists better_auth_email_change_one_pending_per_profile
  on public.better_auth_email_change_requests (profile_id)
  where completed_at is null and revoked_at is null;
create index if not exists better_auth_email_change_expiry_idx
  on public.better_auth_email_change_requests (expires_at);

create or replace function public.create_workspace_account_invitation(
  p_workspace_id uuid,
  p_inviter_profile_id uuid,
  p_email text,
  p_account_role text,
  p_token_hash text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_status text;
  v_archived_at timestamptz;
  v_primary_admin_profile_id uuid;
  v_account_category text;
  v_max_admins integer;
  v_actor_workspace_id uuid;
  v_actor_role text;
  v_actor_is_active boolean;
  v_admin_count integer;
  v_pending_admin_invites integer;
  v_invitation_id uuid;
  v_send_email boolean := false;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if p_workspace_id is null
     or p_inviter_profile_id is null
     or v_email = ''
     or p_account_role is null
     or p_account_role not in ('tenant_account', 'workspace_admin')
     or p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '73 hours' then
    raise exception 'invalid invitation';
  end if;

  select workspace.status, workspace.archived_at,
         workspace.primary_admin_profile_id, policy.account_category,
         policy.max_admins
    into v_workspace_status, v_archived_at,
         v_primary_admin_profile_id, v_account_category, v_max_admins
  from public.workspaces as workspace
  left join public.workspace_policies as policy
    on policy.workspace_id = workspace.id
  where workspace.id = p_workspace_id
  for update of workspace;

  if not found
     or v_archived_at is not null
     or v_workspace_status is distinct from 'active'
     or v_account_category = 'individual' then
    raise exception 'workspace is unavailable';
  end if;

  select profile.workspace_id, profile.role, profile.is_active
    into v_actor_workspace_id, v_actor_role, v_actor_is_active
  from public.profiles as profile
  where profile.id = p_inviter_profile_id
    and profile.deleted_at is null
  for update;

  if not found
     or v_actor_workspace_id is distinct from p_workspace_id
     or v_actor_role is distinct from 'workspace_admin'
     or v_actor_is_active is not true then
    raise exception 'active workspace admin access required';
  end if;

  if p_account_role = 'workspace_admin' then
    if v_primary_admin_profile_id is distinct from p_inviter_profile_id then
      raise exception 'active primary workspace admin access required';
    end if;

    select count(*)::integer into v_admin_count
    from public.profiles as profile
    where profile.workspace_id = p_workspace_id
      and profile.role = 'workspace_admin'
      and profile.deleted_at is null;

    select count(*)::integer into v_pending_admin_invites
    from public.workspace_account_invitations as invitation
    where invitation.workspace_id = p_workspace_id
      and invitation.account_role = 'workspace_admin'
      and invitation.email <> v_email
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now();

    if v_max_admins is not null
       and v_admin_count + v_pending_admin_invites >= v_max_admins then
      raise exception 'workspace administrator limit reached';
    end if;
  end if;

  delete from public.workspace_account_invitations as invitation
  where invitation.expires_at <= now() - interval '30 days';

  insert into public.workspace_account_invitations as current_invitation (
    workspace_id, inviter_profile_id, email, account_role,
    token_hash, created_at, expires_at, accepted_at,
    accepted_profile_id, revoked_at
  ) values (
    p_workspace_id, p_inviter_profile_id, v_email, p_account_role,
    p_token_hash, now(), p_expires_at, null, null, null
  )
  on conflict (workspace_id, lower(email))
    where accepted_at is null and revoked_at is null
  do update set
    inviter_profile_id = excluded.inviter_profile_id,
    account_role = excluded.account_role,
    token_hash = excluded.token_hash,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at,
    accepted_profile_id = null
  where current_invitation.account_role = excluded.account_role
     or excluded.account_role = 'workspace_admin'
     or (
       excluded.account_role = 'tenant_account'
       and v_primary_admin_profile_id = p_inviter_profile_id
     )
  returning id into v_invitation_id;

  v_send_email := v_invitation_id is not null;
  return jsonb_build_object('send_email', v_send_email);
end;
$$;

create or replace function public.accept_workspace_account_invitation(
  p_token_hash text,
  p_profile_id uuid,
  p_user_id text,
  p_account_id text,
  p_member_id text,
  p_password_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.workspace_account_invitations%rowtype;
  v_workspace_id uuid;
  v_workspace_status text;
  v_archived_at timestamptz;
  v_organization_id text;
  v_account_category text;
  v_actor_workspace_id uuid;
  v_actor_role text;
  v_actor_is_active boolean;
  v_membership_count integer;
begin
  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_profile_id is null
     or nullif(p_user_id, '') is null
     or nullif(p_account_id, '') is null
     or nullif(p_member_id, '') is null
     or nullif(p_password_hash, '') is null then
    raise exception 'invitation cannot be accepted';
  end if;

  -- Match the lock order used by create_workspace_account_invitation: lock
  -- the workspace first, then the invitation and inviter rows. This prevents
  -- deadlocks when an admin refreshes an invite while its recipient accepts.
  select invitation.workspace_id into v_workspace_id
  from public.workspace_account_invitations as invitation
  where invitation.token_hash = p_token_hash;

  if not found or v_workspace_id is null then
    raise exception 'invitation cannot be accepted';
  end if;

  select workspace.status, workspace.archived_at,
         workspace.better_auth_organization_id, policy.account_category
    into v_workspace_status, v_archived_at,
         v_organization_id, v_account_category
  from public.workspaces as workspace
  left join public.workspace_policies as policy
    on policy.workspace_id = workspace.id
  where workspace.id = v_workspace_id
  for update of workspace;

  if not found
     or v_archived_at is not null
     or v_workspace_status is distinct from 'active'
     or v_organization_id is null
     or v_account_category = 'individual' then
    raise exception 'invitation cannot be accepted';
  end if;

  select invitation.* into v_invitation
  from public.workspace_account_invitations as invitation
  where invitation.token_hash = p_token_hash
    and invitation.workspace_id = v_workspace_id
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > now()
  for update;

  if not found then
    raise exception 'invitation cannot be accepted';
  end if;

  select profile.workspace_id, profile.role, profile.is_active
    into v_actor_workspace_id, v_actor_role, v_actor_is_active
  from public.profiles as profile
  where profile.id = v_invitation.inviter_profile_id
    and profile.deleted_at is null
  for update;

  if not found
     or v_actor_workspace_id is distinct from v_invitation.workspace_id
     or v_actor_role is distinct from 'workspace_admin'
     or v_actor_is_active is not true then
    raise exception 'invitation cannot be accepted';
  end if;

  if v_invitation.account_role = 'workspace_admin' then
    perform public.workspace_admin_create_profile(
      v_invitation.inviter_profile_id,
      v_invitation.workspace_id,
      p_profile_id,
      v_invitation.email
    );
  else
    insert into public.profiles (
      id, workspace_id, auth_email, role, is_active
    ) values (
      p_profile_id, v_invitation.workspace_id, v_invitation.email,
      'tenant_account', true
    );
  end if;

  perform public.better_auth_create_user(
    p_profile_id,
    p_user_id,
    p_account_id,
    v_invitation.email,
    v_invitation.email,
    'user',
    p_password_hash,
    v_invitation.workspace_id,
    p_member_id,
    v_invitation.account_role
  );

  if v_invitation.account_role = 'workspace_admin' then
    update better_auth.member
    set role = 'admin'
    where "userId" = p_user_id
      and role = 'workspace_admin';
    get diagnostics v_membership_count = row_count;
    if v_membership_count <> 1 then
      raise exception 'invitation cannot be accepted';
    end if;
  end if;

  update public.workspace_account_invitations
  set accepted_at = now(), accepted_profile_id = p_profile_id
  where id = v_invitation.id;

  return jsonb_build_object(
    'profile_id', p_profile_id,
    'workspace_id', v_invitation.workspace_id,
    'email', v_invitation.email,
    'role', v_invitation.account_role
  );
end;
$$;

create or replace function public.create_better_auth_email_change_request(
  p_profile_id uuid,
  p_new_email text,
  p_approval_token_hash text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_better_auth_user_id text;
  v_current_email text;
  v_new_email text := lower(trim(coalesce(p_new_email, '')));
  v_request_id uuid;
begin
  if p_profile_id is null
     or v_new_email = ''
     or p_approval_token_hash is null
     or p_approval_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '61 minutes' then
    raise exception 'email change request is invalid';
  end if;

  select profile.better_auth_user_id
    into v_better_auth_user_id
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.is_active is true
    and profile.deleted_at is null;

  if not found or nullif(v_better_auth_user_id, '') is null then
    raise exception 'email change request is invalid';
  end if;

  perform 1
  from better_auth."user" as auth_user
  where auth_user.id = v_better_auth_user_id
  for update;

  if not found then
    raise exception 'email change request is invalid';
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.better_auth_user_id = v_better_auth_user_id
    and profile.is_active is true
    and profile.deleted_at is null
  for update;

  if not found then
    raise exception 'email change request is invalid';
  end if;

  select auth_user.email into v_current_email
  from better_auth."user" as auth_user
  where auth_user.id = v_better_auth_user_id
  for update;

  v_current_email := lower(trim(coalesce(v_current_email, '')));
  if v_current_email = '' or v_current_email = v_new_email then
    raise exception 'email change request is invalid';
  end if;

  delete from public.better_auth_email_change_requests as request
  where request.expires_at <= now() - interval '30 days'
     or request.completed_at <= now() - interval '30 days'
     or request.revoked_at <= now() - interval '30 days';

  update public.better_auth_email_change_requests as request
  set revoked_at = now()
  where request.profile_id = p_profile_id
    and request.completed_at is null
    and request.revoked_at is null;

  insert into public.better_auth_email_change_requests (
    profile_id, better_auth_user_id, current_email, new_email,
    approval_token_hash, created_at, expires_at
  ) values (
    p_profile_id, v_better_auth_user_id, v_current_email, v_new_email,
    p_approval_token_hash, now(), p_expires_at
  ) returning id into v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'current_email', v_current_email
  );
end;
$$;

create or replace function public.approve_better_auth_email_change(
  p_approval_token_hash text,
  p_verification_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.better_auth_email_change_requests%rowtype;
begin
  if p_approval_token_hash is null
     or p_approval_token_hash !~ '^[0-9a-f]{64}$'
     or p_verification_token_hash is null
     or p_verification_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'email change request is invalid';
  end if;

  select request.* into v_request
  from public.better_auth_email_change_requests as request
  where request.approval_token_hash = p_approval_token_hash
    and request.current_email_approved_at is null
    and request.completed_at is null
    and request.revoked_at is null
    and request.expires_at > now()
  for update;

  if not found then
    raise exception 'email change request is invalid';
  end if;

  update public.better_auth_email_change_requests
  set current_email_approved_at = coalesce(current_email_approved_at, now()),
      verification_token_hash = p_verification_token_hash
  where id = v_request.id;

  return jsonb_build_object(
    'request_id', v_request.id,
    'new_email', v_request.new_email
  );
end;
$$;

create or replace function public.complete_better_auth_email_change(
  p_verification_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.better_auth_email_change_requests%rowtype;
  v_profile_id uuid;
  v_better_auth_user_id text;
  v_updated_rows integer;
begin
  if p_verification_token_hash is null
     or p_verification_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('success', false);
  end if;

  -- Request creation locks the Better Auth user, profile, then request row.
  -- Follow that same order here; the email-sync trigger updates profiles.
  select request.profile_id, request.better_auth_user_id
    into v_profile_id, v_better_auth_user_id
  from public.better_auth_email_change_requests as request
  where request.verification_token_hash = p_verification_token_hash
    and request.current_email_approved_at is not null
    and request.completed_at is null
    and request.revoked_at is null
    and request.expires_at > now();

  if not found then
    return jsonb_build_object('success', false);
  end if;

  if nullif(v_better_auth_user_id, '') is null then
    return jsonb_build_object('success', false);
  end if;

  perform 1
  from better_auth."user" as auth_user
  where auth_user.id = v_better_auth_user_id
  for update;

  if not found then
    return jsonb_build_object('success', false);
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = v_profile_id
    and profile.better_auth_user_id = v_better_auth_user_id
    and profile.is_active is true
    and profile.deleted_at is null
  for update;

  if not found then
    return jsonb_build_object('success', false);
  end if;

  select request.* into v_request
  from public.better_auth_email_change_requests as request
  where request.verification_token_hash = p_verification_token_hash
    and request.profile_id = v_profile_id
    and request.better_auth_user_id = v_better_auth_user_id
    and request.current_email_approved_at is not null
    and request.completed_at is null
    and request.revoked_at is null
    and request.expires_at > now()
  for update;

  if not found then
    return jsonb_build_object('success', false);
  end if;

  begin
    update better_auth."user" as auth_user
    set email = v_request.new_email,
        "emailVerified" = true,
        "updatedAt" = now()
    where auth_user.id = v_request.better_auth_user_id
      and lower(trim(auth_user.email)) = v_request.current_email;
    get diagnostics v_updated_rows = row_count;
  exception when unique_violation then
    update public.better_auth_email_change_requests
    set revoked_at = now(), verification_token_hash = null
    where id = v_request.id;
    return jsonb_build_object('success', false);
  end;

  if v_updated_rows <> 1 then
    update public.better_auth_email_change_requests
    set revoked_at = now(), verification_token_hash = null
    where id = v_request.id;
    return jsonb_build_object('success', false);
  end if;

  update public.better_auth_email_change_requests
  set completed_at = now(), verification_token_hash = null
  where id = v_request.id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.create_workspace_account_invitation(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.accept_workspace_account_invitation(text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_workspace_account_invitation(uuid, uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.accept_workspace_account_invitation(text, uuid, text, text, text, text)
  to service_role;
revoke all on function public.create_better_auth_email_change_request(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.approve_better_auth_email_change(text, text)
  from public, anon, authenticated;
revoke all on function public.complete_better_auth_email_change(text)
  from public, anon, authenticated;
grant execute on function public.create_better_auth_email_change_request(uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.approve_better_auth_email_change(text, text)
  to service_role;
grant execute on function public.complete_better_auth_email_change(text)
  to service_role;

create or replace function private.sync_better_auth_email_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(trim(new.email)) is not distinct from lower(trim(old.email)) then
    return new;
  end if;

  update public.profiles as profile
  set auth_email = lower(trim(new.email))
  where profile.better_auth_user_id = new.id
    and profile.auth_email is distinct from lower(trim(new.email));

  return new;
end;
$$;

revoke all on function private.sync_better_auth_email_to_profile()
  from public, anon, authenticated;

drop trigger if exists sync_better_auth_email_to_profile on better_auth."user";
create trigger sync_better_auth_email_to_profile
after update of email on better_auth."user"
for each row execute function private.sync_better_auth_email_to_profile();

commit;
