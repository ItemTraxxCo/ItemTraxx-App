\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.workspaces') is null
     or to_regclass('public.item_access_grants') is null
     or to_regclass('public.borrower_access_grants') is null
     or to_regclass('public.account_sessions') is null then
    raise exception 'workspace tables missing';
  end if;
  if to_regclass('public.tenants') is not null or to_regclass('public.districts') is not null then
    raise exception 'legacy hierarchy remains';
  end if;
  if exists(select 1 from public.profiles where role in ('tenant_admin','tenant_user','district_admin')) then
    raise exception 'legacy roles remain';
  end if;
  if (select role from public.profiles where id='30000000-0000-0000-0000-000000000001') <> 'workspace_admin'
     or (select role from public.profiles where id='30000000-0000-0000-0000-000000000002') <> 'tenant_account' then
    raise exception 'legacy roles were not mapped';
  end if;
  if (select account_category from public.workspace_policies where workspace_id='20000000-0000-0000-0000-000000000001') <> 'organization' then
    raise exception 'account_category changed';
  end if;
  if exists(select 1 from public.privileged_session_stepups where role_scope <> 'workspace_admin')
     or (select count(*) from public.privileged_session_stepups where role_scope = 'workspace_admin') <> 2 then
    raise exception 'legacy privileged step-up scopes were not preserved and mapped';
  end if;
end $$;

insert into public.workspaces(id,name,slug) values
  ('20000000-0000-0000-0000-000000000002','Other Workspace','other-workspace');
insert into auth.users(id,email) values
  ('30000000-0000-0000-0000-000000000003','other-account@example.test'),
  ('30000000-0000-0000-0000-000000000004','late-account@example.test');
insert into public.profiles(id,workspace_id,role,auth_email) values
  ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','tenant_account','other-account@example.test'),
  ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','tenant_account','late-account@example.test');

do $$
begin
  begin
    update public.workspaces set primary_admin_profile_id='30000000-0000-0000-0000-000000000004'
    where id='20000000-0000-0000-0000-000000000001';
    raise exception 'Tenant Account was accepted as Primary Workspace Admin';
  exception when check_violation then null;
  end;
  begin
    update public.workspaces set primary_admin_profile_id='30000000-0000-0000-0000-000000000001'
    where id='20000000-0000-0000-0000-000000000002';
    raise exception 'cross-workspace Primary Workspace Admin was accepted';
  exception when check_violation then null;
  end;
end $$;
insert into auth.sessions(id,user_id) values
  ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003'),
  ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000004');
insert into public.account_sessions(workspace_id,profile_id,device_id,auth_session_id) values
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','admin-device','40000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','account-device','40000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','other-device','40000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004','late-device','40000000-0000-0000-0000-000000000004');

insert into public.items(id,workspace_id,name,status,barcode,access_mode) values
  ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','All Item','available','ALL-1','all'),
  ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Granted Item','available','GRANT-1','restricted'),
  ('50000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Hidden Item','available','HIDDEN-1','restricted'),
  ('50000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','Other Item','available','OTHER-1','all');
insert into public.borrowers(id,workspace_id,username,borrower_id,access_mode) values
  ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','All Borrower','ALL-B','all'),
  ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Granted Borrower','GRANT-B','restricted'),
  ('60000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Hidden Borrower','HIDDEN-B','restricted'),
  ('60000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','Other Borrower','OTHER-B','all');
insert into public.item_access_grants(item_id,profile_id) values
  ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');
insert into public.borrower_access_grants(borrower_id,profile_id) values
  ('60000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000002","session_id":"40000000-0000-0000-0000-000000000002"}',true);
do $$ begin
  if (select count(*) from public.items) <> 2 then raise exception 'grant-filtered item visibility failed'; end if;
  if (select count(*) from public.borrowers) <> 2 then raise exception 'grant-filtered borrower visibility failed'; end if;
  if (select count(*) from public.items where barcode in ('HIDDEN-1','OTHER-1')) <> 0 then raise exception 'restricted or cross-workspace item leaked'; end if;
  if (select count(*) from public.borrowers where borrower_id in ('HIDDEN-B','OTHER-B')) <> 0 then raise exception 'restricted or cross-workspace borrower leaked'; end if;
  if (select count(*) from public.account_sessions) <> 1 then raise exception 'own-session isolation failed'; end if;
  update public.items set name='forbidden' where id='50000000-0000-0000-0000-000000000001';
  if found then raise exception 'tenant account wrote item'; end if;
end $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000004","session_id":"40000000-0000-0000-0000-000000000004"}',true);
do $$ begin
  if (select count(*) from public.items) <> 1 then raise exception 'all-mode is not live for later accounts'; end if;
  if (select count(*) from public.borrowers) <> 1 then raise exception 'all-mode borrower is not live for later accounts'; end if;
end $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","session_id":"40000000-0000-0000-0000-000000000001"}',true);
do $$ begin
  if (select count(*) from public.items) <> 3 then raise exception 'workspace admin visibility failed'; end if;
  update public.items set name='cross-workspace-write' where id='50000000-0000-0000-0000-000000000004';
  if found then raise exception 'cross-workspace admin write succeeded'; end if;
end $$;
rollback;

update public.account_sessions set revoked_at=now()
where profile_id='30000000-0000-0000-0000-000000000002';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000002","session_id":"40000000-0000-0000-0000-000000000002"}',true);
do $$ begin
  if (select count(*) from public.items) <> 0 then raise exception 'revoked session retained data access'; end if;
end $$;
rollback;

select 'workspace model assertions passed' as result;
