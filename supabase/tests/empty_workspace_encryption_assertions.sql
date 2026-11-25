\set ON_ERROR_STOP on
begin;
insert into public.workspaces(id,name,slug,status) values ('efc18f35-259c-44f6-98d6-ad24d5eab301','New Workspace','new-encryption-test','suspended');
do $$ begin
  if has_function_privilege('authenticated','public.initialize_empty_workspace_borrower_encryption(uuid)','execute') then raise exception 'initialization exposed to client'; end if;
  begin perform public.initialize_empty_workspace_borrower_encryption('efc18f35-259c-44f6-98d6-ad24d5eab301'); raise exception 'missing key accepted'; exception when object_not_in_prerequisite_state then null; end;
end $$;
insert into public.sgw_workspace_key_lifecycle(workspace_id,state) values ('efc18f35-259c-44f6-98d6-ad24d5eab301','active');
insert into public.borrowers(id,workspace_id,username,borrower_id) values ('efc18f35-259c-44f6-98d6-ad24d5eab302','efc18f35-259c-44f6-98d6-ad24d5eab301','legacy','TEST');
do $$ begin
  begin perform public.initialize_empty_workspace_borrower_encryption('efc18f35-259c-44f6-98d6-ad24d5eab301'); raise exception 'nonempty workspace accepted'; exception when object_not_in_prerequisite_state then null; end;
end $$;
delete from public.borrowers where id='efc18f35-259c-44f6-98d6-ad24d5eab302';
select public.initialize_empty_workspace_borrower_encryption('efc18f35-259c-44f6-98d6-ad24d5eab301');
do $$ begin
  if not public.borrower_workspace_encryption_enabled('efc18f35-259c-44f6-98d6-ad24d5eab301') then raise exception 'mode not enabled'; end if;
  begin insert into public.borrowers(id,workspace_id,username,borrower_id) values (gen_random_uuid(),'efc18f35-259c-44f6-98d6-ad24d5eab301','plaintext','ID'); raise exception 'plaintext insert accepted'; exception when check_violation then null; end;
end $$;
update public.workspaces set status='active' where id='efc18f35-259c-44f6-98d6-ad24d5eab301';
do $$ begin
  begin perform public.initialize_empty_workspace_borrower_encryption('efc18f35-259c-44f6-98d6-ad24d5eab301'); raise exception 'active workspace accepted'; exception when object_not_in_prerequisite_state then null; end;
end $$;
rollback;
