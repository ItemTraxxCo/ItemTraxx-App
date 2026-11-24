-- Synthetic fixtures only; all changes roll back.
\set ON_ERROR_STOP on
begin;
insert into public.workspaces(id,name,slug,status) values ('df0dd635-259c-44f6-98d6-ad24d5eab301','Restore Test','individual-restore-test','active');
insert into public.workspace_policies(workspace_id,account_category) values ('df0dd635-259c-44f6-98d6-ad24d5eab301','individual') on conflict (workspace_id) do update set account_category='individual';
insert into public.profiles(id,workspace_id,role,auth_email,is_active) values ('df0dd635-259c-44f6-98d6-ad24d5eab302','df0dd635-259c-44f6-98d6-ad24d5eab301','individual_account','synthetic@example.test',true);
insert into public.borrowers(id,workspace_id,username,access_mode,encrypted_data,nonce,auth_tag,key_version,borrower_id_hash,deleted_at) values ('df0dd635-259c-44f6-98d6-ad24d5eab303','df0dd635-259c-44f6-98d6-ad24d5eab301','enc_test','restricted','cipher','nonce','tag',1,repeat('a',64),now());
do $$ begin
  if public.restore_encrypted_borrower('df0dd635-259c-44f6-98d6-ad24d5eab301','df0dd635-259c-44f6-98d6-ad24d5eab302','df0dd635-259c-44f6-98d6-ad24d5eab303','cipher','nonce','tag') then
    raise exception 'individual account restored restricted borrower';
  end if;
  if not exists (select 1 from public.borrowers where id='df0dd635-259c-44f6-98d6-ad24d5eab303' and deleted_at is not null) then
    raise exception 'restricted borrower was changed';
  end if;
end $$;
update public.borrowers set access_mode='all' where id='df0dd635-259c-44f6-98d6-ad24d5eab303';
do $$ begin
  if not public.restore_encrypted_borrower('df0dd635-259c-44f6-98d6-ad24d5eab301','df0dd635-259c-44f6-98d6-ad24d5eab302','df0dd635-259c-44f6-98d6-ad24d5eab303','cipher','nonce','tag') then
    raise exception 'individual account could not restore an all-access borrower';
  end if;
end $$;
rollback;
