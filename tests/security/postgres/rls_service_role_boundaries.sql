\set ON_ERROR_STOP on
begin;
\ir ./security_fixture.sql

-- Every public table carrying a workspace_id must have RLS enabled. This
-- catches a newly added tenant table omitted from the RLS migration pass.
do $$
declare
  unsafe_table text;
begin
  -- `column` is a reserved word and cannot be an alias; use neutral aliases.
  select rel.relname into unsafe_table
  from pg_class as rel
  join pg_namespace as nsp on nsp.oid = rel.relnamespace
  join pg_attribute as att on att.attrelid = rel.oid
  where nsp.nspname = 'public'
    and rel.relkind in ('r', 'p')
    and att.attname = 'workspace_id'
    and not att.attisdropped
    and not rel.relrowsecurity
  order by rel.relname
  limit 1;
  if unsafe_table is not null then
    raise exception 'workspace-scoped table public.% has RLS disabled', unsafe_table;
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"itx-security-session-a-member","org_id":"itx-security-org-b","workspace_id":"10000000-0000-4000-8000-000000000002","tenant_id":"10000000-0000-4000-8000-000000000002"}',
  true
);

do $$
declare
  affected integer;
  visible integer;
begin
  if auth.uid() is distinct from '11000000-0000-4000-8000-000000000002'::uuid
     or public.current_workspace_id() is distinct from '10000000-0000-4000-8000-000000000001'::uuid
     or public.current_user_role() is distinct from 'tenant_account' then
    raise exception 'RLS identity did not remain bound to the authenticated profile';
  end if;

  -- Positive controls: own workspace and own item are visible, so the zero-row
  -- probes below measure isolation rather than an unresolved session.
  select count(*) into visible from public.workspaces
  where id = '10000000-0000-4000-8000-000000000001';
  if visible <> 1 then raise exception 'positive control: own workspace not visible'; end if;
  select count(*) into visible from public.items
  where id = '30000000-0000-4000-8000-000000000001';
  if visible <> 1 then raise exception 'positive control: own item not visible'; end if;

  select count(*) into visible from public.workspaces
  where id = '10000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'foreign workspace was readable through a forged org claim'; end if;
  select count(*) into visible from public.items
  where id = '30000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'foreign item was readable despite matching foreign keys'; end if;

  -- Tenant members can read the narrow settings surface but not billing or
  -- invoice metadata even when they know the workspace and row UUID.
  select count(*) into visible from public.workspace_policies
  where workspace_id = '10000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'foreign workspace policy leaked'; end if;
  begin
    execute 'select billing_email from public.workspace_policies where workspace_id = $1'
      using '10000000-0000-4000-8000-000000000001'::uuid;
    raise exception 'tenant member selected billing metadata';
  exception when insufficient_privilege then
    null;
  end;

  -- A client may supply arbitrary custom JSON claims, but the RLS owner
  -- derives identity from auth.uid() and public.profiles, not org/workspace claims.
  begin
    update public.items set name = 'forged org update'
    where id = '30000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'forged org claim permitted a foreign item update'; end if;
  exception when insufficient_privilege then
    null;
  end;

  -- Direct browser access to sensitive Better Auth schema and privileged RPCs
  -- must fail at grants, before any argument can be trusted.
  begin
    perform count(*) from better_auth.session;
    raise exception 'authenticated role read private Better Auth sessions';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.workspace_admin_set_profile_role(
      '11000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000002',
      'workspace_admin'
    );
    raise exception 'authenticated role executed privileged role RPC';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.create_workspace_account_invitation(
      '10000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000002',
      'attacker@example.test',
      'workspace_admin',
      repeat('a', 64),
      now() + interval '1 hour'
    );
    raise exception 'authenticated role created a workspace invitation';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.run_data_retention();
    raise exception 'authenticated role invoked data/audit retention';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.profiles
    set role = 'super_admin', workspace_id = '10000000-0000-4000-8000-000000000002'
    where id = '11000000-0000-4000-8000-000000000002';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'direct profile mass assignment succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update better_auth.session
    set "activeOrganizationId" = 'itx-security-org-b'
    where id = 'itx-security-session-a-member';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'direct session organization tampering succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update better_auth.member set role = 'admin'
    where "userId" = '11000000-0000-4000-8000-000000000002'
      and "organizationId" = 'itx-security-org-a';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'direct Better Auth membership role tampering succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.admin_audit_logs(
      workspace_id, actor_id, action_type, metadata
    ) values (
      '10000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000002',
      'forged_chain_of_custody_export',
      '{"retention_days":0,"exported":true,"workspace_id":"10000000-0000-4000-8000-000000000002"}'
    );
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'forged audit metadata was inserted'; end if;
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;
do $$
declare
  profile_role text;
  profile_workspace uuid;
begin
  select role, workspace_id into profile_role, profile_workspace
  from public.profiles where id = '11000000-0000-4000-8000-000000000002';
  -- `is distinct from` so a deleted row (NULL) fails instead of passing.
  if profile_role is distinct from 'tenant_account'
     or profile_workspace is distinct from '10000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'failed profile/role forgery mutated profile state';
  end if;
  if (select "activeOrganizationId" from better_auth.session where id = 'itx-security-session-a-member') is distinct from 'itx-security-org-a' then
    raise exception 'failed session refresh payload changed Better Auth organization';
  end if;
  if (select role from better_auth.member where "userId" = '11000000-0000-4000-8000-000000000002' and "organizationId" = 'itx-security-org-a') is distinct from 'tenant_account' then
    raise exception 'failed Better Auth role payload changed organization membership';
  end if;
  if exists (
    select 1 from public.workspace_account_invitations
    where email = 'attacker@example.test'
  ) then raise exception 'failed member invitation created a row'; end if;
  if exists (
    select 1 from public.admin_audit_logs
    where action_type = 'forged_chain_of_custody_export'
  ) then raise exception 'failed forged audit write created a row'; end if;
end
$$;

-- Even a trusted service-role caller must not be able to use a member ID as
-- the actor for an admin-only role change or invitation.
set local role service_role;
do $$
declare
  v_message text;
begin
  begin
    perform public.workspace_admin_set_profile_role(
      '11000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000002',
      'workspace_admin'
    );
    raise exception 'service role accepted tenant member as role-change actor';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%active workspace admin access required%' then raise; end if;
  end;

  begin
    perform public.create_workspace_account_invitation(
      '10000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000002',
      'member-forged-admin@example.test',
      'workspace_admin',
      repeat('b', 64),
      now() + interval '1 hour'
    );
    raise exception 'service role accepted tenant member as inviter';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%active workspace admin access required%' then raise; end if;
  end;

  begin
    perform public.workspace_admin_set_profile_role(
      '11000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000002',
      'super_admin'
    );
    raise exception 'role RPC accepted an unsupported privileged role';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%invalid workspace account role%' then raise; end if;
  end;
end
$$;

reset role;
do $$
begin
  if (select role from public.profiles where id = '11000000-0000-4000-8000-000000000002') is distinct from 'tenant_account' then
    raise exception 'service-side role guard failed to preserve profile role';
  end if;
  if exists (
    select 1 from public.workspace_account_invitations
    where email in ('member-forged-admin@example.test')
  ) then raise exception 'service-side invitation guard created a row'; end if;
  if exists (
    select 1 from public.admin_audit_logs
    where action_type = 'set_workspace_account_role'
      and entity_id = '11000000-0000-4000-8000-000000000002'
  ) then raise exception 'failed role escalation generated an audit event'; end if;
end
$$;

rollback;
