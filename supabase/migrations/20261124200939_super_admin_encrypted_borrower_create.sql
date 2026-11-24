-- Some environments predate the dedicated super-admin audit table. Existing
-- installations retain their policies; newly created tables are service-only.
create table if not exists public.super_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action_type text not null,
  target_type text,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table public.super_admin_audit_logs enable row level security;
grant select, insert on public.super_admin_audit_logs to service_role;

-- Service-only: the caller has already verified the super-admin session and step-up.
create function public.super_create_encrypted_borrower(
  p_id uuid, p_workspace_id uuid, p_actor_id uuid, p_encrypted_data text,
  p_nonce text, p_auth_tag text, p_borrower_id_hash text, p_borrower_email_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or p_workspace_id is null or p_actor_id is null
    or coalesce(p_encrypted_data, '') = '' or coalesce(p_nonce, '') = '' or coalesce(p_auth_tag, '') = ''
    or coalesce(p_borrower_id_hash, '') !~ '^[a-f0-9]{64}$'
    or (p_borrower_email_hash is not null and p_borrower_email_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'Invalid encrypted borrower' using errcode = '22023';
  end if;
  perform 1 from public.profiles p where p.id = p_actor_id and p.role = 'super_admin' and p.is_active is true and p.deleted_at is null for share;
  if not found then raise exception 'Unauthorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.status = 'active') then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.borrowers b where b.workspace_id = p_workspace_id and b.encrypted_data is null) then
    raise exception 'Workspace backfill incomplete' using errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':borrower_hash:' || p_borrower_id_hash, 0));
  if exists (select 1 from public.borrowers b where b.workspace_id = p_workspace_id and b.borrower_id_hash = p_borrower_id_hash and b.deleted_at is null) then
    raise exception 'Borrower ID already exists' using errcode = '23505';
  end if;
  insert into public.borrowers(id, workspace_id, username, borrower_id, access_mode, encrypted_data, nonce, auth_tag, key_version, borrower_id_hash, borrower_email_hash)
  values (p_id, p_workspace_id, 'enc_' || p_id::text, null, 'all', p_encrypted_data, p_nonce, p_auth_tag, 1, p_borrower_id_hash, p_borrower_email_hash);
  insert into public.super_admin_audit_logs(actor_id, actor_email, action_type, target_type, target_id, metadata)
  select (select u.id from auth.users u where u.id = p.id), p.auth_email, 'create_borrower', 'borrower', p_id::text, jsonb_build_object('workspace_id', p_workspace_id, 'actor_profile_id', p.id)
  from public.profiles p where p.id = p_actor_id;
  return p_id;
end; $$;
revoke all on function public.super_create_encrypted_borrower(uuid,uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.super_create_encrypted_borrower(uuid,uuid,uuid,text,text,text,text,text) to service_role;

-- The Edge Function verifies the super-admin password before calling this.
create function public.super_delete_encrypted_borrower(p_id uuid, p_actor_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor_email text; target_workspace uuid;
begin
  select p.auth_email into actor_email from public.profiles p
    where p.id = p_actor_id and p.role = 'super_admin' and p.is_active is true and p.deleted_at is null for share;
  if not found then raise exception 'Unauthorized' using errcode = '42501'; end if;
  delete from public.borrowers where id = p_id returning workspace_id into target_workspace;
  if not found then return false; end if;
  insert into public.super_admin_audit_logs(actor_id, actor_email, action_type, target_type, target_id, metadata)
  values ((select u.id from auth.users u where u.id = p_actor_id), actor_email, 'delete_borrower', 'borrower', p_id::text,
    jsonb_build_object('workspace_id', target_workspace, 'actor_profile_id', p_actor_id));
  return true;
end; $$;
revoke all on function public.super_delete_encrypted_borrower(uuid,uuid) from public, anon, authenticated;
grant execute on function public.super_delete_encrypted_borrower(uuid,uuid) to service_role;
