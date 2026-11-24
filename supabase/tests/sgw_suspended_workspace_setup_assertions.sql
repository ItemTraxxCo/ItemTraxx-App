-- Run only against an isolated local database; all fixtures are rolled back.
begin;
insert into public.workspaces(id, name, slug, status)
values ('41ce68dc-72db-4b45-a862-a77f17894a19', 'Synthetic Organization', 'synthetic-org-check', 'suspended');
select public.better_auth_create_organization('41ce68dc-72db-4b45-a862-a77f17894a19', 'Synthetic Organization', 'synthetic-org-check');
insert into public.profiles(id, workspace_id, role, auth_email)
values ('cddac892-4093-4a8c-8d0d-98408748ace2', '41ce68dc-72db-4b45-a862-a77f17894a19', 'workspace_admin', 'synthetic@example.test');
select public.better_auth_create_user(
  'cddac892-4093-4a8c-8d0d-98408748ace2', 'local-user-01', 'local-account-01',
  'synthetic@example.test', 'Synthetic', 'user', 'test-only-password-hash',
  '41ce68dc-72db-4b45-a862-a77f17894a19', 'local-member-01', 'workspace_admin'
);
do $$
begin
  if (select status from public.workspaces where id = '41ce68dc-72db-4b45-a862-a77f17894a19') <> 'suspended' then
    raise exception 'initial setup left workspace active';
  end if;
  if (select role from better_auth.member where id = 'local-member-01') <> 'admin' then
    raise exception 'initial workspace admin membership has the wrong role';
  end if;
  begin
    insert into better_auth.member(id, "organizationId", "userId", role, "createdAt")
    values ('unexpected-member', '41ce68dc-72db-4b45-a862-a77f17894a19', 'local-user-01', 'workspace_admin', now());
    raise exception 'direct membership unexpectedly allowed';
  exception when raise_exception then
    if sqlerrm <> 'Better Auth organization requires an active workspace' then raise; end if;
  end;
  update public.workspaces set primary_admin_profile_id = 'cddac892-4093-4a8c-8d0d-98408748ace2'
  where id = '41ce68dc-72db-4b45-a862-a77f17894a19';
  insert into public.profiles(id, workspace_id, role, auth_email)
  values ('2057e2db-6f97-4e0a-86ad-50d26f51f42d', '41ce68dc-72db-4b45-a862-a77f17894a19', 'workspace_admin', 'second@example.test');
  begin
    perform public.better_auth_create_user(
      '2057e2db-6f97-4e0a-86ad-50d26f51f42d', 'local-user-02', 'local-account-02',
      'second@example.test', 'Synthetic Two', 'user', 'test-only-password-hash',
      '41ce68dc-72db-4b45-a862-a77f17894a19', 'local-member-02', 'workspace_admin'
    );
    raise exception 'suspended established workspace accepted a new administrator';
  exception when raise_exception then
    if sqlerrm <> 'Better Auth organization requires an active workspace' then raise; end if;
  end;
  if has_function_privilege('anon', 'public.better_auth_create_user(uuid,text,text,text,text,text,text,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.better_auth_create_user(uuid,text,text,text,text,text,text,uuid,text,text)', 'execute') then
    raise exception 'unprivileged role may create Better Auth users';
  end if;
end;
$$;
rollback;
