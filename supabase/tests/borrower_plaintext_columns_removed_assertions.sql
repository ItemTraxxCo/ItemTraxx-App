-- Run against an isolated test database after applying the removal migration.
-- All fixture changes are rolled back.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public'
    and table_name='borrowers' and column_name in ('username','borrower_id')) then
    raise exception 'legacy plaintext borrower columns still exist';
  end if;
end $$;
do $$ begin
  begin
    perform public.commit_borrower_encryption_cutover(gen_random_uuid(),gen_random_uuid());
    raise exception 'retired cutover routine was callable';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'Legacy borrower operation retired' then raise; end if;
  end;
end $$;
insert into public.workspaces(id,name,slug,status) values
 ('f74d347e-222b-422a-9ccd-ae009967a106','Legacy Mode Test','retired-legacy-mode-test','active');
do $$ begin
  begin
    insert into public.borrowers(id,workspace_id,encrypted_data,nonce,auth_tag,key_version,borrower_id_hash)
    values (gen_random_uuid(),'f74d347e-222b-422a-9ccd-ae009967a106','cipher','nonce','tag',1,repeat('a',64));
    raise exception 'legacy mode accepted a borrower write';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'Encrypted borrower workspace required' then raise; end if;
  end;
end $$;
insert into public.workspaces(id,name,slug,status)
values ('f74d347e-222b-422a-9ccd-ae009967a101','Column Removal Test','column-removal-test','suspended');
insert into public.sgw_workspace_key_lifecycle(workspace_id,state) values ('f74d347e-222b-422a-9ccd-ae009967a101','active');
select public.initialize_empty_workspace_borrower_encryption('f74d347e-222b-422a-9ccd-ae009967a101');
update public.workspaces set status='active' where id='f74d347e-222b-422a-9ccd-ae009967a101';
insert into public.profiles(id,workspace_id,role,auth_email,is_active)
values ('f74d347e-222b-422a-9ccd-ae009967a102',null,'super_admin','synthetic@example.test',true);
select public.super_create_encrypted_borrower('f74d347e-222b-422a-9ccd-ae009967a103',
  'f74d347e-222b-422a-9ccd-ae009967a101','f74d347e-222b-422a-9ccd-ae009967a102',
  'cipher','nonce','tag',repeat('a',64),null);
do $$ begin
  if not exists (select 1 from public.borrowers where id='f74d347e-222b-422a-9ccd-ae009967a103'
    and encrypted_data='cipher' and borrower_id_hash=repeat('a',64)) then
    raise exception 'encrypted borrower creation failed';
  end if;
end $$;
insert into public.profiles(id,workspace_id,role,auth_email,is_active) values
 ('f74d347e-222b-422a-9ccd-ae009967a104','f74d347e-222b-422a-9ccd-ae009967a101','workspace_admin','admin@example.test',true);
insert into public.items(id,workspace_id,name,status) values
 ('f74d347e-222b-422a-9ccd-ae009967a105','f74d347e-222b-422a-9ccd-ae009967a101','Synthetic item','available');
do $$ declare result jsonb; begin
 result := public.apply_checkout_return_item('f74d347e-222b-422a-9ccd-ae009967a101','f74d347e-222b-422a-9ccd-ae009967a104',
   'f74d347e-222b-422a-9ccd-ae009967a105','synthetic-checkout','checkout','f74d347e-222b-422a-9ccd-ae009967a103');
 if result->>'status' <> 'processed' or result->>'action_type' <> 'checkout' then raise exception 'checkout failed: %',result; end if;
 result := public.apply_checkout_return_item('f74d347e-222b-422a-9ccd-ae009967a101','f74d347e-222b-422a-9ccd-ae009967a104',
   'f74d347e-222b-422a-9ccd-ae009967a105','synthetic-return','return','f74d347e-222b-422a-9ccd-ae009967a103');
 if result->>'status' <> 'processed' or result->>'action_type' <> 'return' then raise exception 'return failed: %',result; end if;
end $$;
rollback;
