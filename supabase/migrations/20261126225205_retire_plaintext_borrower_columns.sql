-- Removing legacy columns is safe only after every borrower has a complete envelope.
-- Locks prevent borrower or mode changes during the cutover.
lock table public.borrowers in access exclusive mode;
lock table private.borrower_write_freezes in share row exclusive mode;
do $$ begin
  if exists (select 1 from public.borrowers where coalesce(encrypted_data,'')='' or coalesce(nonce,'')='' or coalesce(auth_tag,'')='' or key_version is distinct from 1 or coalesce(borrower_id_hash,'') !~ '^[a-f0-9]{64}$' or borrower_id is not null or username is distinct from 'enc_' || id::text) then
    raise exception 'Borrower encryption cutover incomplete' using errcode='55000';
  end if;
  if exists (select 1 from public.workspaces w join private.borrower_write_freezes f on f.workspace_id=w.id where w.status='active' and not f.encrypted_only and not f.frozen) then
    raise exception 'Active legacy workspace must be migrated or frozen' using errcode='55000';
  end if;
end $$;

CREATE OR REPLACE FUNCTION private.enforce_encrypted_borrower_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare encrypted boolean;
begin
  if tg_op = 'UPDATE' then
    select encrypted_only into encrypted from private.borrower_write_freezes where workspace_id=old.workspace_id for share;
    if not found then raise exception 'Workspace encryption state unavailable' using errcode='55000'; end if;
    if encrypted and (new.workspace_id is distinct from old.workspace_id or new.id is distinct from old.id) then
      raise exception 'Encrypted borrower identity cannot change' using errcode='23514';
    end if;
  end if;
  select encrypted_only into encrypted from private.borrower_write_freezes where workspace_id=new.workspace_id for share;
  if not found then raise exception 'Workspace encryption state unavailable' using errcode='55000'; end if;
  if not encrypted then raise exception 'Encrypted borrower workspace required' using errcode='55000'; end if;
  if encrypted and ((to_jsonb(new) ? 'username' and to_jsonb(new)->>'username' is distinct from 'enc_' || new.id::text) or to_jsonb(new)->>'borrower_id' is not null
    or coalesce(new.encrypted_data,'')='' or coalesce(new.nonce,'')='' or coalesce(new.auth_tag,'')=''
    or new.key_version is distinct from 1 or coalesce(new.borrower_id_hash,'') !~ '^[a-f0-9]{64}$'
    or (new.borrower_email_hash is not null and new.borrower_email_hash !~ '^[a-f0-9]{64}$')) then
    raise exception 'Encrypted borrower required' using errcode='23514';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.backfill_encrypted_borrower(p_workspace_id uuid, p_id uuid, p_expected_username text, p_expected_borrower_id text, p_ciphertext text, p_nonce text, p_auth_tag text, p_borrower_id_hash text, p_email_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception 'Legacy borrower operation retired' using errcode = '55000';
end;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_encrypted_borrower_v2(p_workspace_id uuid, p_id uuid, p_expected_username text, p_expected_borrower_id text, p_ciphertext text, p_nonce text, p_auth_tag text, p_borrower_id_hash text, p_email_hash text, p_freeze_epoch uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception 'Legacy borrower operation retired' using errcode = '55000';
end;
$function$;

CREATE OR REPLACE FUNCTION public.commit_borrower_encryption_cutover(p_workspace_id uuid, p_freeze_epoch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception 'Legacy borrower operation retired' using errcode = '55000';
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_borrower_identity(p_workspace_id uuid, p_username text, p_borrower_id text, p_access_mode text, p_profile_ids uuid[] DEFAULT '{}'::uuid[], p_granted_by uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, workspace_id uuid, username text, borrower_id text, access_mode text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception 'Legacy borrower operation retired' using errcode = '55000';
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_borrower_with_audit(p_workspace_id uuid, p_actor_id uuid, p_borrower_id uuid)
 RETURNS TABLE(id uuid, workspace_id uuid, username text, borrower_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception 'Legacy borrower operation retired' using errcode = '55000';
end;
$function$;

alter table public.borrowers drop column username, drop column borrower_id;

