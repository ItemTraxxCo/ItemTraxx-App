-- Call only after the backfill runner has decrypted and verified every row in
-- this freeze generation. This check alone cannot authenticate ciphertext.
create function public.scrub_borrower_identity_audit_metadata(p_workspace_id uuid, p_freeze_epoch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare freeze_row record; admin_count integer; super_count integer;
begin
  if p_workspace_id is null or p_freeze_epoch is null then raise exception 'Invalid request' using errcode='22023'; end if;
  select frozen,freeze_epoch into freeze_row from private.borrower_write_freezes where workspace_id=p_workspace_id for share;
  if not found or not freeze_row.frozen or freeze_row.freeze_epoch is distinct from p_freeze_epoch then
    raise exception 'Borrower write freeze changed' using errcode='55000';
  end if;
  if exists (select 1 from public.borrowers b where b.workspace_id=p_workspace_id and
    (coalesce(b.encrypted_data,'')='' or coalesce(b.nonce,'')='' or coalesce(b.auth_tag,'')='' or b.key_version is distinct from 1 or coalesce(b.borrower_id_hash,'') !~ '^[a-f0-9]{64}$')) then
    raise exception 'Workspace backfill incomplete' using errcode='55000';
  end if;
  update public.admin_audit_logs set metadata=metadata - array['username','borrower_id','first_name','last_name','email','display_name']::text[]
    where workspace_id=p_workspace_id and entity_type='borrower' and metadata ?| array['username','borrower_id','first_name','last_name','email','display_name'];
  get diagnostics admin_count = row_count;
  update public.super_admin_audit_logs set metadata=metadata - array['username','borrower_id','first_name','last_name','email','display_name']::text[]
    where target_type='borrower' and metadata->>'workspace_id'=p_workspace_id::text and metadata ?| array['username','borrower_id','first_name','last_name','email','display_name'];
  get diagnostics super_count = row_count;
  return jsonb_build_object('admin_rows',admin_count,'super_rows',super_count);
end; $$;
revoke all on function public.scrub_borrower_identity_audit_metadata(uuid,uuid) from public, anon, authenticated;
grant execute on function public.scrub_borrower_identity_audit_metadata(uuid,uuid) to service_role;
