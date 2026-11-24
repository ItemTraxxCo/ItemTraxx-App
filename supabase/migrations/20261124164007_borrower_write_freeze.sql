-- A workspace freeze is coordinated with every borrower write. Transaction
-- locks let concurrent normal writes proceed, while activation waits for them.
create table private.borrower_write_freezes (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  frozen boolean not null default false,
  updated_at timestamptz not null default now()
);
create table private.borrower_backfill_write_capabilities (
  backend_pid integer not null,
  transaction_id bigint not null,
  workspace_id uuid not null,
  borrower_id uuid not null,
  primary key (backend_pid, transaction_id, workspace_id, borrower_id)
);
revoke all on private.borrower_write_freezes, private.borrower_backfill_write_capabilities from public, anon, authenticated, service_role;

-- The row must predate a writer's snapshot. A missing row is never treated as
-- unfrozen: otherwise a repeatable-read transaction could miss a new freeze.
create function private.initialize_borrower_write_freeze()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.borrower_write_freezes(workspace_id) values (new.id);
  return new;
end $$;
revoke all on function private.initialize_borrower_write_freeze() from public, anon, authenticated, service_role;
create trigger initialize_borrower_write_freeze after insert on public.workspaces
for each row execute function private.initialize_borrower_write_freeze();
insert into private.borrower_write_freezes(workspace_id)
select id from public.workspaces on conflict (workspace_id) do nothing;

create function public.set_borrower_write_freeze(p_workspace_id uuid, p_frozen boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_workspace_id is null or p_frozen is null then raise exception 'Invalid freeze request' using errcode='22023'; end if;
  update private.borrower_write_freezes set frozen=p_frozen, updated_at=now() where workspace_id=p_workspace_id;
  if not found then raise exception 'Workspace freeze state unavailable' using errcode='55000'; end if;
end $$;
revoke all on function public.set_borrower_write_freeze(uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_borrower_write_freeze(uuid,boolean) to service_role;

create function public.borrower_write_freeze_is_active(p_workspace_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select (select frozen from private.borrower_write_freezes where workspace_id=p_workspace_id)
$$;
revoke all on function public.borrower_write_freeze_is_active(uuid) from public, anon, authenticated;
grant execute on function public.borrower_write_freeze_is_active(uuid) to service_role;

create function private.enforce_borrower_write_freeze()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_workspace uuid; new_workspace uuid; scope uuid; is_frozen boolean;
begin
  if tg_op <> 'INSERT' then old_workspace := old.workspace_id; end if;
  if tg_op <> 'DELETE' then new_workspace := new.workspace_id; end if;
  for scope in select distinct w from unnest(array[old_workspace,new_workspace]) w where w is not null order by w loop
    select frozen into is_frozen from private.borrower_write_freezes where workspace_id=scope for share;
    if not found then
      -- The workspace BEFORE DELETE guard checks the freeze before its row can
      -- be removed by cascading deletes. Permit only that parent-delete case.
      if tg_op='DELETE' and not exists (select 1 from public.workspaces where id=scope) then return old; end if;
      raise exception 'Workspace freeze state unavailable' using errcode='55000';
    end if;
    if is_frozen
       and not (tg_op='UPDATE' and old_workspace=new_workspace and exists (
         select 1 from private.borrower_backfill_write_capabilities
         where backend_pid=pg_catalog.pg_backend_pid() and transaction_id=pg_catalog.txid_current()
           and workspace_id=scope and borrower_id=old.id
       )) then
      raise exception 'Borrower writes temporarily paused' using errcode='55000';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.enforce_borrower_write_freeze() from public, anon, authenticated, service_role;
create trigger borrower_write_freeze_guard before insert or update or delete on public.borrowers
for each row execute function private.enforce_borrower_write_freeze();

create function private.guard_frozen_workspace_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare is_frozen boolean;
begin
  select frozen into is_frozen from private.borrower_write_freezes where workspace_id=old.id for update;
  if not found or is_frozen then raise exception 'Workspace freeze state unavailable or frozen' using errcode='55000'; end if;
  return old;
end $$;
revoke all on function private.guard_frozen_workspace_deletion() from public, anon, authenticated, service_role;
create trigger guard_frozen_workspace_deletion before delete on public.workspaces
for each row execute function private.guard_frozen_workspace_deletion();

create function public.backfill_encrypted_borrower(
  p_workspace_id uuid, p_id uuid, p_expected_username text, p_expected_borrower_id text,
  p_ciphertext text, p_nonce text, p_auth_tag text, p_borrower_id_hash text, p_email_hash text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer; is_frozen boolean;
begin
  if p_workspace_id is null or p_id is null or p_expected_username is null or p_expected_borrower_id is null
     or coalesce(p_ciphertext,'')='' or coalesce(p_nonce,'')='' or coalesce(p_auth_tag,'')=''
     or coalesce(p_borrower_id_hash,'') !~ '^[a-f0-9]{64}$'
     or (p_email_hash is not null and p_email_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'Invalid encrypted borrower' using errcode='22023';
  end if;
  select frozen into is_frozen from private.borrower_write_freezes where workspace_id=p_workspace_id for share;
  if not found or not is_frozen then
    raise exception 'Borrower write freeze required' using errcode='55000';
  end if;
  insert into private.borrower_backfill_write_capabilities values (pg_catalog.pg_backend_pid(),pg_catalog.txid_current(),p_workspace_id,p_id);
  update public.borrowers set encrypted_data=p_ciphertext, nonce=p_nonce, auth_tag=p_auth_tag,
    key_version=1, borrower_id_hash=p_borrower_id_hash, borrower_email_hash=p_email_hash
  where workspace_id=p_workspace_id and id=p_id and username=p_expected_username
    and borrower_id=p_expected_borrower_id and encrypted_data is null;
  get diagnostics changed = row_count;
  delete from private.borrower_backfill_write_capabilities where backend_pid=pg_catalog.pg_backend_pid()
    and transaction_id=pg_catalog.txid_current() and workspace_id=p_workspace_id and borrower_id=p_id;
  return changed=1;
end $$;
revoke all on function public.backfill_encrypted_borrower(uuid,uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.backfill_encrypted_borrower(uuid,uuid,text,text,text,text,text,text,text) to service_role;
