-- Synthetic records only. Every change is rolled back.
\set ON_ERROR_STOP on
begin;
insert into public.workspaces(id,name,slug,status) values ('8df56c35-259c-44f6-98d6-ad24d5eab301','Encryption Test','super-encrypted-create-test','active');
insert into public.profiles(id,workspace_id,role,auth_email,is_active) values ('8df56c35-259c-44f6-98d6-ad24d5eab302',null,'super_admin','synthetic@example.test',true);
do $$ begin
  if has_function_privilege('authenticated', 'public.super_create_encrypted_borrower(uuid,uuid,uuid,text,text,text,text,text)', 'execute') then raise exception 'function exposed to authenticated'; end if;
  if has_function_privilege('authenticated', 'public.super_delete_encrypted_borrower(uuid,uuid)', 'execute') then raise exception 'delete exposed to authenticated'; end if;
  begin
    perform public.super_create_encrypted_borrower('8df56c35-259c-44f6-98d6-ad24d5eab303','8df56c35-259c-44f6-98d6-ad24d5eab301',gen_random_uuid(),'cipher','nonce','tag',repeat('a',64),null);
    raise exception 'unauthorized actor succeeded';
  exception when insufficient_privilege then null; end;
  perform public.super_create_encrypted_borrower('8df56c35-259c-44f6-98d6-ad24d5eab303','8df56c35-259c-44f6-98d6-ad24d5eab301','8df56c35-259c-44f6-98d6-ad24d5eab302','cipher','nonce','tag',repeat('a',64),null);
  if not exists (select 1 from public.borrowers where id='8df56c35-259c-44f6-98d6-ad24d5eab303' and username='enc_8df56c35-259c-44f6-98d6-ad24d5eab303' and borrower_id is null and encrypted_data='cipher' and borrower_id_hash=repeat('a',64)) then raise exception 'encrypted row invalid'; end if;
  if not exists (select 1 from public.super_admin_audit_logs where target_id='8df56c35-259c-44f6-98d6-ad24d5eab303' and actor_id is null and metadata->>'actor_profile_id'='8df56c35-259c-44f6-98d6-ad24d5eab302' and not metadata ? 'borrower_id') then raise exception 'audit invalid'; end if;
  begin
    perform public.super_create_encrypted_borrower('8df56c35-259c-44f6-98d6-ad24d5eab304','8df56c35-259c-44f6-98d6-ad24d5eab301','8df56c35-259c-44f6-98d6-ad24d5eab302','cipher','nonce','tag',repeat('a',64),null);
    raise exception 'duplicate ID succeeded';
  exception when unique_violation then null; end;
end $$;
insert into public.borrowers(id,workspace_id,username,borrower_id) values ('8df56c35-259c-44f6-98d6-ad24d5eab307','8df56c35-259c-44f6-98d6-ad24d5eab301','synthetic legacy','SYNTH123');
do $$ begin
  begin
    perform public.super_create_encrypted_borrower('8df56c35-259c-44f6-98d6-ad24d5eab308','8df56c35-259c-44f6-98d6-ad24d5eab301','8df56c35-259c-44f6-98d6-ad24d5eab302','cipher','nonce','tag',repeat('d',64),null);
    raise exception 'create succeeded during incomplete backfill';
  exception when object_not_in_prerequisite_state then null; end;
end $$;
delete from public.borrowers where id='8df56c35-259c-44f6-98d6-ad24d5eab307';
select public.set_borrower_write_freeze('8df56c35-259c-44f6-98d6-ad24d5eab301', true);
do $$ begin
  begin
    perform public.super_create_encrypted_borrower('8df56c35-259c-44f6-98d6-ad24d5eab306','8df56c35-259c-44f6-98d6-ad24d5eab301','8df56c35-259c-44f6-98d6-ad24d5eab302','cipher','nonce','tag',repeat('c',64),null);
    raise exception 'create succeeded while frozen';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform public.super_delete_encrypted_borrower('8df56c35-259c-44f6-98d6-ad24d5eab303','8df56c35-259c-44f6-98d6-ad24d5eab302');
    raise exception 'delete succeeded while frozen';
  exception when object_not_in_prerequisite_state then null; end;
end $$;
select public.set_borrower_write_freeze('8df56c35-259c-44f6-98d6-ad24d5eab301', false);
alter table public.super_admin_audit_logs add constraint super_create_test_reject_audit check (action_type <> 'create_borrower') not valid;
do $$ begin
  begin
    perform public.super_create_encrypted_borrower('8df56c35-259c-44f6-98d6-ad24d5eab305','8df56c35-259c-44f6-98d6-ad24d5eab301','8df56c35-259c-44f6-98d6-ad24d5eab302','cipher','nonce','tag',repeat('b',64),null);
    raise exception 'create succeeded without audit';
  exception when check_violation then null; end;
  if exists (select 1 from public.borrowers where id='8df56c35-259c-44f6-98d6-ad24d5eab305') then raise exception 'borrower persisted after audit failure'; end if;
  begin
    perform public.super_delete_encrypted_borrower('8df56c35-259c-44f6-98d6-ad24d5eab303',gen_random_uuid());
    raise exception 'unauthorized delete succeeded';
  exception when insufficient_privilege then null; end;
end $$;
alter table public.super_admin_audit_logs add constraint super_delete_test_reject_audit check (action_type <> 'delete_borrower') not valid;
do $$ begin
  begin
    perform public.super_delete_encrypted_borrower('8df56c35-259c-44f6-98d6-ad24d5eab303','8df56c35-259c-44f6-98d6-ad24d5eab302');
    raise exception 'delete succeeded without audit';
  exception when check_violation then null; end;
  if not exists (select 1 from public.borrowers where id='8df56c35-259c-44f6-98d6-ad24d5eab303') then raise exception 'borrower deleted after audit failure'; end if;
end $$;
alter table public.super_admin_audit_logs drop constraint super_delete_test_reject_audit;
do $$ begin
  if not public.super_delete_encrypted_borrower('8df56c35-259c-44f6-98d6-ad24d5eab303','8df56c35-259c-44f6-98d6-ad24d5eab302') then raise exception 'delete failed'; end if;
  if not exists (select 1 from public.super_admin_audit_logs where target_id='8df56c35-259c-44f6-98d6-ad24d5eab303' and action_type='delete_borrower' and not metadata ? 'borrower_id') then raise exception 'delete audit invalid'; end if;
end $$;
rollback;
