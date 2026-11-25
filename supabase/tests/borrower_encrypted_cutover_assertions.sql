\set ON_ERROR_STOP on
begin;
insert into public.workspaces(id,name,slug,status) values ('bdd8b135-259c-44f6-98d6-ad24d5eab301','Cutover Test','cutover-test','active'),('bdd8b135-259c-44f6-98d6-ad24d5eab302','Other','cutover-test-other','active');
insert into public.sgw_workspace_key_lifecycle(workspace_id,state) values ('bdd8b135-259c-44f6-98d6-ad24d5eab301','active');
insert into public.borrowers(id,workspace_id,username,borrower_id) values ('bdd8b135-259c-44f6-98d6-ad24d5eab303','bdd8b135-259c-44f6-98d6-ad24d5eab301','synthetic legacy','ID123');
insert into public.super_admin_audit_logs(action_type,target_type,metadata) values ('create_borrower','borrower','{"workspace_id":"bdd8b135-259c-44f6-98d6-ad24d5eab301","borrower_id":"ID123","other":"preserved"}');
do $$ begin
  if has_function_privilege('authenticated','public.commit_borrower_encryption_cutover(uuid,uuid)','execute') then raise exception 'cutover exposed to client'; end if;
  if has_function_privilege('authenticated','public.borrower_workspace_encryption_modes(uuid[])','execute') then raise exception 'modes exposed to client'; end if;
  begin perform public.commit_borrower_encryption_cutover('bdd8b135-259c-44f6-98d6-ad24d5eab301',gen_random_uuid()); raise exception 'unfrozen cutover succeeded'; exception when object_not_in_prerequisite_state then null; end;
end $$;
select public.set_borrower_write_freeze('bdd8b135-259c-44f6-98d6-ad24d5eab301',true);
do $$ declare epoch uuid; begin
  epoch := public.borrower_write_freeze_epoch('bdd8b135-259c-44f6-98d6-ad24d5eab301');
  begin perform public.commit_borrower_encryption_cutover('bdd8b135-259c-44f6-98d6-ad24d5eab301',epoch); raise exception 'incomplete cutover succeeded'; exception when object_not_in_prerequisite_state then null; end;
  if not public.backfill_encrypted_borrower_v2('bdd8b135-259c-44f6-98d6-ad24d5eab301','bdd8b135-259c-44f6-98d6-ad24d5eab303','synthetic legacy','ID123','cipher','nonce','tag',repeat('a',64),null,epoch) then raise exception 'fixture backfill failed'; end if;
  update public.sgw_workspace_key_lifecycle set state='revoked' where workspace_id='bdd8b135-259c-44f6-98d6-ad24d5eab301';
  begin perform public.commit_borrower_encryption_cutover('bdd8b135-259c-44f6-98d6-ad24d5eab301',epoch); raise exception 'revoked key accepted'; exception when object_not_in_prerequisite_state then null; end;
  update public.sgw_workspace_key_lifecycle set state='active' where workspace_id='bdd8b135-259c-44f6-98d6-ad24d5eab301';
  begin perform public.commit_borrower_encryption_cutover('bdd8b135-259c-44f6-98d6-ad24d5eab301',gen_random_uuid()); raise exception 'stale epoch accepted'; exception when object_not_in_prerequisite_state then null; end;
end $$;
alter table public.super_admin_audit_logs add constraint cutover_test_reject_scrub check (metadata ? 'borrower_id') not valid;
do $$ declare epoch uuid; begin
  epoch := public.borrower_write_freeze_epoch('bdd8b135-259c-44f6-98d6-ad24d5eab301');
  begin perform public.commit_borrower_encryption_cutover('bdd8b135-259c-44f6-98d6-ad24d5eab301',epoch); raise exception 'audit failure accepted'; exception when check_violation then null; end;
  if public.borrower_workspace_encryption_enabled('bdd8b135-259c-44f6-98d6-ad24d5eab301') or not exists (select 1 from public.borrowers where id='bdd8b135-259c-44f6-98d6-ad24d5eab303' and username='synthetic legacy' and borrower_id='ID123') then raise exception 'failed cutover was not atomic'; end if;
end $$;
alter table public.super_admin_audit_logs drop constraint cutover_test_reject_scrub;
do $$ declare epoch uuid; begin
  epoch := public.borrower_write_freeze_epoch('bdd8b135-259c-44f6-98d6-ad24d5eab301');
  perform public.commit_borrower_encryption_cutover('bdd8b135-259c-44f6-98d6-ad24d5eab301',epoch);
  if not public.borrower_workspace_encryption_enabled('bdd8b135-259c-44f6-98d6-ad24d5eab301') then raise exception 'mode not set'; end if;
  if (select count(*) from public.borrower_workspace_encryption_modes(array['bdd8b135-259c-44f6-98d6-ad24d5eab301'::uuid,'bdd8b135-259c-44f6-98d6-ad24d5eab302'::uuid]) where encrypted_only) <> 1 then raise exception 'workspace modes invalid'; end if;
  if public.borrower_write_freeze_epoch('bdd8b135-259c-44f6-98d6-ad24d5eab301') is distinct from epoch then raise exception 'cutover unfroze workspace'; end if;
  if not exists (select 1 from public.borrowers where id='bdd8b135-259c-44f6-98d6-ad24d5eab303' and username='enc_bdd8b135-259c-44f6-98d6-ad24d5eab303' and borrower_id is null and encrypted_data='cipher') then raise exception 'plaintext retained'; end if;
  if not exists (select 1 from public.super_admin_audit_logs where metadata->>'workspace_id'='bdd8b135-259c-44f6-98d6-ad24d5eab301' and not metadata ? 'borrower_id' and metadata->>'other'='preserved') then raise exception 'audit scrub incomplete'; end if;
end $$;
select public.set_borrower_write_freeze('bdd8b135-259c-44f6-98d6-ad24d5eab301',false);
do $$ begin
  begin insert into public.borrowers(id,workspace_id,username,borrower_id) values (gen_random_uuid(),'bdd8b135-259c-44f6-98d6-ad24d5eab301','plaintext','ID999'); raise exception 'plaintext write succeeded'; exception when check_violation then null; end;
  begin update public.borrowers set username='plaintext' where id='bdd8b135-259c-44f6-98d6-ad24d5eab303'; raise exception 'plaintext update succeeded'; exception when check_violation then null; end;
  begin update public.borrowers set workspace_id='bdd8b135-259c-44f6-98d6-ad24d5eab302' where id='bdd8b135-259c-44f6-98d6-ad24d5eab303'; raise exception 'workspace move succeeded'; exception when check_violation then null; when raise_exception then if sqlerrm <> 'inventory workspace cannot be changed' then raise; end if; end;
end $$;
rollback;
