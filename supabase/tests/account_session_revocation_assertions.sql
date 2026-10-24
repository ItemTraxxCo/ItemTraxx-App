\set ON_ERROR_STOP on

begin;

insert into better_auth.organization (id, name, slug, "createdAt")
values (
  '99000000-0000-0000-0000-000000000001',
  'RLS Test Workspace',
  'rls-test-workspace',
  now()
);

insert into public.workspaces (id, name, slug, status, better_auth_organization_id)
values (
  '99000000-0000-0000-0000-000000000001',
  'RLS Test Workspace',
  'rls-test-workspace',
  'active',
  '99000000-0000-0000-0000-000000000001'
);

insert into better_auth."user" (id, name, email, "emailVerified")
values (
  '99000000-0000-0000-0000-000000000002',
  'RLS Test User',
  'rls-test-user@example.test',
  true
);

insert into public.profiles (id, workspace_id, role, auth_email, better_auth_user_id)
values (
  '99000000-0000-0000-0000-000000000002',
  '99000000-0000-0000-0000-000000000001',
  'tenant_account',
  'rls-test-user@example.test',
  '99000000-0000-0000-0000-000000000002'
);

insert into better_auth.session (id, "expiresAt", token, "updatedAt", "userId")
values (
  '99000000-0000-0000-0000-000000000003',
  now() + interval '1 hour',
  'rls-test-session-token',
  now(),
  '99000000-0000-0000-0000-000000000002'
);

insert into public.account_sessions (workspace_id, profile_id, device_id, auth_session_id)
values (
  '99000000-0000-0000-0000-000000000001',
  '99000000-0000-0000-0000-000000000002',
  'rls-test-device',
  '99000000-0000-0000-0000-000000000003'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '99000000-0000-0000-0000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-000000000002","session_id":"99000000-0000-0000-0000-000000000003"}',
  true
);

do $$ begin
  if (select count(*) from public.account_sessions) <> 1 then
    raise exception 'active session could not read its own session record';
  end if;
end $$;

reset role;
update public.account_sessions
set revoked_at = now()
where profile_id = '99000000-0000-0000-0000-000000000002';

set local role authenticated;
do $$ begin
  if (select count(*) from public.account_sessions) <> 0 then
    raise exception 'revoked session could still read its own session record';
  end if;
end $$;

rollback;

select 'account session revocation RLS assertions passed' as result;
