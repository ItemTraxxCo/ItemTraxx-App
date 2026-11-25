\set ON_ERROR_STOP on
begin;
insert into public.workspaces(id,name,slug,status) values ('1ca9ae35-259c-44f6-98d6-ad24d5eab301','Provision Test','sgw-provision-cipher-test','active');
insert into public.borrowers(id,workspace_id,username,encrypted_data,nonce,auth_tag,key_version,borrower_id_hash) values ('1ca9ae35-259c-44f6-98d6-ad24d5eab302','1ca9ae35-259c-44f6-98d6-ad24d5eab301','opaque','cipher','nonce','tag',1,repeat('a',64));
do $$ begin
  if has_function_privilege('authenticated','public.sgw_key_lifecycle_transition(uuid,text)','execute') then raise exception 'lifecycle exposed to client'; end if;
  if public.sgw_key_lifecycle_transition('1ca9ae35-259c-44f6-98d6-ad24d5eab301','claim_provision') then raise exception 'provisioned over existing ciphertext'; end if;
end $$;
delete from public.borrowers where id='1ca9ae35-259c-44f6-98d6-ad24d5eab302';
update private.borrower_write_freezes set encrypted_only=true where workspace_id='1ca9ae35-259c-44f6-98d6-ad24d5eab301';
do $$ begin
  if public.sgw_key_lifecycle_transition('1ca9ae35-259c-44f6-98d6-ad24d5eab301','claim_provision') then raise exception 'provisioned over encrypted-only workspace'; end if;
  update private.borrower_write_freezes set encrypted_only=false where workspace_id='1ca9ae35-259c-44f6-98d6-ad24d5eab301';
  if not public.sgw_key_lifecycle_transition('1ca9ae35-259c-44f6-98d6-ad24d5eab301','claim_provision') then raise exception 'fresh workspace could not claim'; end if;
  if public.sgw_key_lifecycle_transition('1ca9ae35-259c-44f6-98d6-ad24d5eab301','claim_provision') then raise exception 'duplicate claim accepted'; end if;
end $$;
rollback;
