-- Synthetic records only. Verify compatibility changes without dropping columns.
\set ON_ERROR_STOP on
begin;
insert into public.workspaces(id,name,slug,status) values
 ('1cb12874-78da-4048-9236-726d646b8101','Compatibility Test','borrower-column-compat-test','suspended');
insert into public.sgw_workspace_key_lifecycle(workspace_id,state) values
 ('1cb12874-78da-4048-9236-726d646b8101','active');
select public.initialize_empty_workspace_borrower_encryption('1cb12874-78da-4048-9236-726d646b8101');
update public.workspaces set status='active' where id='1cb12874-78da-4048-9236-726d646b8101';
insert into public.profiles(id,workspace_id,role,auth_email,is_active) values
 ('1cb12874-78da-4048-9236-726d646b8102','1cb12874-78da-4048-9236-726d646b8101','workspace_admin','synthetic@example.test',true);
select public.create_encrypted_borrower('1cb12874-78da-4048-9236-726d646b8103',
 '1cb12874-78da-4048-9236-726d646b8101','1cb12874-78da-4048-9236-726d646b8102',
 'cipher','nonce','tag',repeat('a',64),null,'all','{}'::uuid[]);
do $$ begin
 if not exists (select 1 from public.borrowers where id='1cb12874-78da-4048-9236-726d646b8103'
   and username='enc_1cb12874-78da-4048-9236-726d646b8103' and borrower_id is null
   and encrypted_data='cipher' and borrower_id_hash=repeat('a',64)) then raise exception 'encrypted create failed'; end if;
 if not public.update_borrower_access_with_audit('1cb12874-78da-4048-9236-726d646b8101',
   '1cb12874-78da-4048-9236-726d646b8102','1cb12874-78da-4048-9236-726d646b8103','all','{}'::uuid[]) then raise exception 'access update failed'; end if;
 if not public.archive_borrower_with_audit('1cb12874-78da-4048-9236-726d646b8101',
   '1cb12874-78da-4048-9236-726d646b8102','1cb12874-78da-4048-9236-726d646b8103') then raise exception 'archive failed'; end if;
end $$;
rollback;
