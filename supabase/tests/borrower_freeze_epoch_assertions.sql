-- Isolated local database only; fixtures and mutations roll back.
\set ON_ERROR_STOP on
begin;
insert into public.workspaces(id,name,slug,status) values ('c0402a80-976a-41f1-b63c-5ec51f0e7b01','Epoch Test','epoch-freeze-test','active');
insert into public.borrowers(id,workspace_id,username,borrower_id) values ('c0402a80-976a-41f1-b63c-5ec51f0e7b02','c0402a80-976a-41f1-b63c-5ec51f0e7b01','Synthetic','1234AB');
do $$ declare previous_epoch uuid; current_epoch uuid; begin
  perform public.set_borrower_write_freeze('c0402a80-976a-41f1-b63c-5ec51f0e7b01',true);
  previous_epoch := public.borrower_write_freeze_epoch('c0402a80-976a-41f1-b63c-5ec51f0e7b01');
  perform public.set_borrower_write_freeze('c0402a80-976a-41f1-b63c-5ec51f0e7b01',false);
  if public.borrower_write_freeze_epoch('c0402a80-976a-41f1-b63c-5ec51f0e7b01') is not null then raise exception 'inactive freeze returned an epoch'; end if;
  perform public.set_borrower_write_freeze('c0402a80-976a-41f1-b63c-5ec51f0e7b01',true);
  current_epoch := public.borrower_write_freeze_epoch('c0402a80-976a-41f1-b63c-5ec51f0e7b01');
  if previous_epoch is null or current_epoch is null or previous_epoch=current_epoch then raise exception 'freeze epoch failed to change'; end if;
  begin
    perform public.backfill_encrypted_borrower_v2('c0402a80-976a-41f1-b63c-5ec51f0e7b01','c0402a80-976a-41f1-b63c-5ec51f0e7b02','Synthetic','1234AB','cipher','nonce','tag',repeat('a',64),null,previous_epoch);
    raise exception 'stale freeze accepted';
  exception when sqlstate '55000' then null; end;
  if not public.backfill_encrypted_borrower_v2('c0402a80-976a-41f1-b63c-5ec51f0e7b01','c0402a80-976a-41f1-b63c-5ec51f0e7b02','Synthetic','1234AB','cipher','nonce','tag',repeat('a',64),null,current_epoch) then raise exception 'valid epoch rejected'; end if;
  if has_function_privilege('service_role','public.backfill_encrypted_borrower(uuid,uuid,text,text,text,text,text,text,text)','execute') or
     has_function_privilege('authenticated','public.borrower_write_freeze_epoch(uuid)','execute') then raise exception 'insecure function privilege'; end if;
end $$;
rollback;
