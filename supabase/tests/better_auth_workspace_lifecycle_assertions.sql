\set ON_ERROR_STOP on

do $$
declare
  v_function regprocedure := to_regprocedure('private.enforce_active_better_auth_workspace_lifecycle()');
begin
  if v_function is null
     or position('for share' in lower(pg_get_functiondef(v_function))) = 0 then
    raise exception 'Better Auth workspace lifecycle trigger does not serialize with workspace status updates';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'better_auth.member'::regclass
      and tgname = 'enforce_active_workspace_lifecycle'
      and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'better_auth.invitation'::regclass
      and tgname = 'enforce_active_workspace_lifecycle'
      and not tgisinternal
  ) then
    raise exception 'Better Auth membership and invitation lifecycle triggers are required';
  end if;
end $$;

begin;
do $$
declare
  v_workspace_id uuid := gen_random_uuid();
  v_organization_id text := gen_random_uuid()::text;
  v_user_id text := gen_random_uuid()::text;
  v_other_user_id text := gen_random_uuid()::text;
  v_member_id text := gen_random_uuid()::text;
  v_invitation_id text := gen_random_uuid()::text;
  v_compensation_invitation_id text := gen_random_uuid()::text;
  v_blocked boolean;
begin
  insert into public.workspaces(id, name, slug)
  values (v_workspace_id, 'Lifecycle Trigger Test', 'lifecycle-' || left(v_workspace_id::text, 12));

  insert into better_auth.organization(id, name, slug, "createdAt")
  values (v_organization_id, 'Lifecycle Trigger Test', 'lifecycle-' || left(v_workspace_id::text, 12), now());
  update public.workspaces
  set better_auth_organization_id = v_organization_id
  where id = v_workspace_id;

  insert into better_auth."user"(id, name, email, "emailVerified", "createdAt", "updatedAt")
  values
    (v_user_id, 'Lifecycle Test', v_user_id || '@example.test', true, now(), now()),
    (v_other_user_id, 'Other Lifecycle Test', v_other_user_id || '@example.test', true, now(), now());

  insert into better_auth.member(id, "organizationId", "userId", role, "createdAt")
  values (v_member_id, v_organization_id, v_user_id, 'tenant_account', now());
  insert into better_auth.invitation(
    id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId"
  ) values (
    v_invitation_id, v_organization_id, 'invitee@example.test', 'tenant_account',
    'pending', now() + interval '1 day', now(), v_user_id
  );
  insert into better_auth.invitation(
    id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId"
  ) values (
    v_compensation_invitation_id, v_organization_id, 'compensation@example.test', 'tenant_account',
    'accepted', now() + interval '1 day', now(), v_user_id
  );

  update public.workspaces
  set status = 'suspended', archived_at = now()
  where id = v_workspace_id;

  v_blocked := false;
  begin
    insert into better_auth.member(id, "organizationId", "userId", role, "createdAt")
    values (gen_random_uuid()::text, v_organization_id, v_user_id, 'tenant_account', now());
  exception when raise_exception then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'membership creation succeeded for an archived workspace';
  end if;

  v_blocked := false;
  begin
    update better_auth.member set role = 'admin' where id = v_member_id;
  exception when raise_exception then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'membership role update succeeded for an archived workspace';
  end if;

  v_blocked := false;
  begin
    update better_auth.member set "userId" = v_other_user_id where id = v_member_id;
  exception when raise_exception then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'membership reassignment succeeded for an archived workspace';
  end if;

  v_blocked := false;
  begin
    insert into better_auth.invitation(
      id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId"
    ) values (
      gen_random_uuid()::text, v_organization_id, 'late-invitee@example.test', 'tenant_account',
      'pending', now() + interval '1 day', now(), v_user_id
    );
  exception when raise_exception then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'invitation creation succeeded for an archived workspace';
  end if;

  v_blocked := false;
  begin
    update better_auth.invitation set status = 'accepted' where id = v_invitation_id;
  exception when raise_exception then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'invitation acceptance succeeded for an archived workspace';
  end if;

  -- Better Auth compensates for a failed member insert by changing an already
  -- accepted invitation back to pending. That status-only rollback must work
  -- after archive so a failed acceptance does not strand the invitation.
  v_blocked := false;
  begin
    update better_auth.invitation
    set status = 'pending', email = 'changed@example.test'
    where id = v_compensation_invitation_id;
  exception when raise_exception then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'invitation rollback changed fields beyond the accepted status';
  end if;

  update better_auth.invitation
  set status = 'pending'
  where id = v_compensation_invitation_id;
  if not exists (
    select 1 from better_auth.invitation
    where id = v_compensation_invitation_id and status = 'pending'
  ) then
    raise exception 'failed invitation acceptance could not return to pending';
  end if;
  update better_auth.invitation
  set status = 'rejected'
  where id = v_compensation_invitation_id;

  update better_auth.invitation set status = 'canceled' where id = v_invitation_id;
  delete from better_auth.member where id = v_member_id;
end $$;
rollback;
