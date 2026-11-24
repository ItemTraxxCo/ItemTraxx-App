-- Run against an isolated local database; all fixtures roll back.
\set ON_ERROR_STOP on
begin;
insert into public.workspaces(id,name,slug,status) values
 ('8319a60d-d1fa-4710-9dc8-0bc306b7fa01','Freeze Test','freeze-test-a','active'),
 ('8319a60d-d1fa-4710-9dc8-0bc306b7fa02','Other Test','freeze-test-b','active');
do $$ begin
  if (select count(*) from private.borrower_write_freezes where workspace_id in ('8319a60d-d1fa-4710-9dc8-0bc306b7fa01','8319a60d-d1fa-4710-9dc8-0bc306b7fa02') and not frozen) <> 2 then
    raise exception 'new workspace freeze state missing';
  end if;
end $$;
insert into public.borrowers(id,workspace_id,username,borrower_id) values
 ('8319a60d-d1fa-4710-9dc8-0bc306b7fa11','8319a60d-d1fa-4710-9dc8-0bc306b7fa01','Test User','ID-1'),
 ('8319a60d-d1fa-4710-9dc8-0bc306b7fa12','8319a60d-d1fa-4710-9dc8-0bc306b7fa02','Other User','ID-2');
do $$ begin
  begin
    perform public.backfill_encrypted_borrower('8319a60d-d1fa-4710-9dc8-0bc306b7fa01','8319a60d-d1fa-4710-9dc8-0bc306b7fa11','Test User','ID-1','cipher','nonce','tag',repeat('a',64),null);
    raise exception 'backfill succeeded without a freeze';
  exception when sqlstate '55000' then null; end;
  if has_table_privilege('service_role','private.borrower_backfill_write_capabilities','insert') or
     has_table_privilege('authenticated','private.borrower_write_freezes','select') then
    raise exception 'freeze internals are exposed';
  end if;
end $$;
select public.set_borrower_write_freeze('8319a60d-d1fa-4710-9dc8-0bc306b7fa01',true);
set local role service_role;
do $$ begin
  begin
    update public.borrowers set username='changed' where id='8319a60d-d1fa-4710-9dc8-0bc306b7fa11';
    raise exception 'frozen update succeeded';
  exception when sqlstate '55000' then null; end;
  begin
    insert into public.borrowers(workspace_id,username,borrower_id) values ('8319a60d-d1fa-4710-9dc8-0bc306b7fa01','new','ID-3');
    raise exception 'frozen insert succeeded';
  exception when sqlstate '55000' then null; end;
  begin
    delete from public.borrowers where id='8319a60d-d1fa-4710-9dc8-0bc306b7fa11';
    raise exception 'frozen delete succeeded';
  exception when sqlstate '55000' then null; end;
  begin
    update public.borrowers set workspace_id='8319a60d-d1fa-4710-9dc8-0bc306b7fa02' where id='8319a60d-d1fa-4710-9dc8-0bc306b7fa11';
    raise exception 'frozen move succeeded';
  exception when sqlstate '55000' then null; end;
  begin
    delete from public.workspaces where id='8319a60d-d1fa-4710-9dc8-0bc306b7fa01';
    raise exception 'frozen workspace deletion succeeded';
  exception when sqlstate '55000' then null; end;
  update public.borrowers set username='allowed' where id='8319a60d-d1fa-4710-9dc8-0bc306b7fa12';
  if has_function_privilege('authenticated','public.set_borrower_write_freeze(uuid,boolean)','execute') or
     has_function_privilege('authenticated','public.backfill_encrypted_borrower(uuid,uuid,text,text,text,text,text,text,text)','execute') then
    raise exception 'freeze functions exposed to authenticated users';
  end if;
  if not public.backfill_encrypted_borrower('8319a60d-d1fa-4710-9dc8-0bc306b7fa01','8319a60d-d1fa-4710-9dc8-0bc306b7fa11','Test User','ID-1','cipher','nonce','tag',repeat('a',64),null) then
    raise exception 'authorized encrypted backfill failed';
  end if;
  if public.backfill_encrypted_borrower('8319a60d-d1fa-4710-9dc8-0bc306b7fa01','8319a60d-d1fa-4710-9dc8-0bc306b7fa11','Test User','ID-1','cipher','nonce','tag',repeat('a',64),null) then
    raise exception 'backfill overwrote existing ciphertext';
  end if;
end $$;
reset role;
select public.set_borrower_write_freeze('8319a60d-d1fa-4710-9dc8-0bc306b7fa01',false);
update public.borrowers set username='unfrozen' where id='8319a60d-d1fa-4710-9dc8-0bc306b7fa11';
delete from private.borrower_write_freezes where workspace_id='8319a60d-d1fa-4710-9dc8-0bc306b7fa02';
do $$ begin
  begin
    update public.borrowers set username='missing state' where id='8319a60d-d1fa-4710-9dc8-0bc306b7fa12';
    raise exception 'missing freeze state was accepted';
  exception when sqlstate '55000' then null; end;
end $$;
insert into private.borrower_write_freezes(workspace_id) values ('8319a60d-d1fa-4710-9dc8-0bc306b7fa02');
delete from public.borrowers where workspace_id='8319a60d-d1fa-4710-9dc8-0bc306b7fa02';
delete from public.workspaces where id='8319a60d-d1fa-4710-9dc8-0bc306b7fa02';
rollback;
