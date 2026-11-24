\set ON_ERROR_STOP on
begin;
insert into public.workspaces(id,name,slug,status) values ('24f9e735-259c-44f6-98d6-ad24d5eab301','Audit Test','audit-scrub-test','active'),('24f9e735-259c-44f6-98d6-ad24d5eab302','Other Test','audit-scrub-other','active');
insert into public.profiles(id,workspace_id,role,auth_email,is_active) values ('24f9e735-259c-44f6-98d6-ad24d5eab303','24f9e735-259c-44f6-98d6-ad24d5eab301','workspace_admin','synthetic@example.test',true);
insert into public.borrowers(id,workspace_id,username,borrower_id) values ('24f9e735-259c-44f6-98d6-ad24d5eab304','24f9e735-259c-44f6-98d6-ad24d5eab301','legacy','LEGACY1');
insert into public.admin_audit_logs(workspace_id,actor_id,action_type,entity_type,metadata) values ('24f9e735-259c-44f6-98d6-ad24d5eab301','24f9e735-259c-44f6-98d6-ad24d5eab303','borrower_create','borrower','{"username":"synthetic","borrower_id":"123","access_mode":"all"}');
insert into public.super_admin_audit_logs(action_type,target_type,metadata) values ('create_borrower','borrower','{"workspace_id":"24f9e735-259c-44f6-98d6-ad24d5eab301","borrower_id":"123"}'),('create_borrower','borrower','{"workspace_id":"24f9e735-259c-44f6-98d6-ad24d5eab302","borrower_id":"456"}');
do $$ begin
  if has_function_privilege('authenticated','public.scrub_borrower_identity_audit_metadata(uuid,uuid)','execute') then raise exception 'scrub exposed to authenticated'; end if;
  begin perform public.scrub_borrower_identity_audit_metadata('24f9e735-259c-44f6-98d6-ad24d5eab301',gen_random_uuid()); raise exception 'unfrozen scrub succeeded'; exception when object_not_in_prerequisite_state then null; end;
end $$;
select public.set_borrower_write_freeze('24f9e735-259c-44f6-98d6-ad24d5eab301',true);
do $$ declare epoch uuid; result jsonb; begin
  epoch := public.borrower_write_freeze_epoch('24f9e735-259c-44f6-98d6-ad24d5eab301');
  begin perform public.scrub_borrower_identity_audit_metadata('24f9e735-259c-44f6-98d6-ad24d5eab301',epoch); raise exception 'incomplete backfill scrub succeeded'; exception when object_not_in_prerequisite_state then null; end;
  if not public.backfill_encrypted_borrower_v2('24f9e735-259c-44f6-98d6-ad24d5eab301','24f9e735-259c-44f6-98d6-ad24d5eab304','legacy','LEGACY1','cipher','nonce','tag',repeat('a',64),null,epoch) then raise exception 'fixture backfill failed'; end if;
  begin perform public.scrub_borrower_identity_audit_metadata('24f9e735-259c-44f6-98d6-ad24d5eab301',gen_random_uuid()); raise exception 'stale epoch accepted'; exception when object_not_in_prerequisite_state then null; end;
  result := public.scrub_borrower_identity_audit_metadata('24f9e735-259c-44f6-98d6-ad24d5eab301',epoch);
  if result <> '{"admin_rows":1,"super_rows":1}'::jsonb then raise exception 'wrong scrub counts'; end if;
  if not exists (select 1 from public.admin_audit_logs where workspace_id='24f9e735-259c-44f6-98d6-ad24d5eab301' and metadata='{"access_mode":"all"}') then raise exception 'audit metadata not preserved'; end if;
  if not exists (select 1 from public.super_admin_audit_logs where metadata->>'workspace_id'='24f9e735-259c-44f6-98d6-ad24d5eab302' and metadata->>'borrower_id'='456') then raise exception 'other workspace changed'; end if;
  result := public.scrub_borrower_identity_audit_metadata('24f9e735-259c-44f6-98d6-ad24d5eab301',epoch);
  if result <> '{"admin_rows":0,"super_rows":0}'::jsonb then raise exception 'scrub not idempotent'; end if;
end $$;
rollback;
