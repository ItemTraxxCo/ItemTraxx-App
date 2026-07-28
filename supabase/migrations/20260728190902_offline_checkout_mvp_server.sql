begin;

-- Edge replay uses this exact conflict target. A non-partial unique index is
-- required because PostgREST cannot use a partial index as an ON CONFLICT
-- arbiter when the request does not carry the index predicate.
create unique index if not exists idx_item_logs_operation_conflict
  on public.item_logs (workspace_id, item_id, action_type, operation_id);

-- The browser's online Quick Return writes one admin audit entry after a
-- successful operation. Offline replay is applied item-by-item, so its audit
-- key includes the operation and item while preserving the same action type
-- and count/barcodes metadata. This makes retry healing idempotent.
create unique index if not exists idx_admin_audit_offline_quick_return_item
  on public.admin_audit_logs (
    workspace_id,
    actor_id,
    (metadata ->> 'operation_id'),
    (metadata ->> 'item_id')
  )
  where action_type = 'quick_return'
    and metadata ->> 'source' = 'offline_replay';

-- A pack is an authorization- and device-bound preparation event. The browser
-- encrypts the returned borrower/item data; the database retains only the item
-- state needed to prove that a later replay originated from that pack.
create table public.offline_checkout_packs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  prepared_at timestamptz not null default now(),
  expires_at timestamptz not null,
  invalidated_at timestamptz null,
  item_count integer not null default 0 check (item_count >= 0),
  borrower_count integer not null default 0 check (borrower_count >= 0),
  constraint offline_checkout_packs_device_length check (char_length(device_id) between 1 and 128),
  constraint offline_checkout_packs_expiry check (
    expires_at > prepared_at and expires_at <= prepared_at + interval '24 hours'
  )
);

create table public.offline_checkout_pack_items (
  pack_id uuid not null references public.offline_checkout_packs(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  snapshot_status text not null,
  snapshot_checked_out_by uuid null references public.borrowers(id) on delete set null,
  primary key (pack_id, item_id)
);

-- Conflicts are persisted server-side so `apply_offline` cannot be used as an
-- untracked browser-side overwrite primitive. One operation has one durable
-- review record even when it contains multiple item conflicts.
create table public.offline_checkout_conflicts (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.offline_checkout_packs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  operation_id text not null,
  offline_payload jsonb not null,
  server_state jsonb not null,
  status text not null default 'pending',
  resolution text null,
  resolution_result jsonb null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references public.profiles(id) on delete set null,
  constraint offline_checkout_conflicts_device_length check (char_length(device_id) between 1 and 128),
  constraint offline_checkout_conflicts_operation_length check (char_length(operation_id) between 1 and 128),
  constraint offline_checkout_conflicts_payload_array check (jsonb_typeof(offline_payload) = 'array'),
  constraint offline_checkout_conflicts_state_array check (jsonb_typeof(server_state) = 'array'),
  constraint offline_checkout_conflicts_status_check check (status in ('pending','kept_server','applied_offline')),
  constraint offline_checkout_conflicts_resolution_check check (resolution is null or resolution in ('keep_server','apply_offline')),
  constraint offline_checkout_conflicts_operation_key
    unique (workspace_id, profile_id, operation_id)
);

create index offline_checkout_packs_owner_device_idx
  on public.offline_checkout_packs(profile_id, device_id, prepared_at desc);
create index offline_checkout_packs_expiry_idx
  on public.offline_checkout_packs(expires_at);
create index offline_checkout_pack_items_item_idx
  on public.offline_checkout_pack_items(item_id, pack_id);
create index offline_checkout_conflicts_pending_idx
  on public.offline_checkout_conflicts(workspace_id, profile_id, created_at)
  where status = 'pending';

alter table public.offline_checkout_packs enable row level security;
alter table public.offline_checkout_pack_items enable row level security;
alter table public.offline_checkout_conflicts enable row level security;

-- Apply one replayed item and its immutable item_logs row in the same database
-- transaction. The function is service-role-only, but still re-validates the
-- account, active pack, workspace/grant boundary, explicit intent, expected
-- state, and (for force resolution) the persisted conflict record.
create function public.apply_offline_checkout_item(
  p_workspace_id uuid,
  p_profile_id uuid,
  p_device_id text,
  p_pack_id uuid,
  p_operation_id text,
  p_item_id uuid,
  p_barcode text,
  p_intent text,
  p_borrower_id uuid,
  p_expected_status text,
  p_expected_checked_out_by uuid,
  p_conflict_id uuid default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  item_row public.items%rowtype;
  target_status text;
  target_borrower uuid;
  log_borrower uuid;
  log_operation_id text;
begin
  if p_workspace_id is null or p_profile_id is null or p_pack_id is null
     or p_item_id is null or coalesce(btrim(p_device_id), '') = ''
     or char_length(p_device_id) > 128
     or coalesce(btrim(p_operation_id), '') = ''
     or char_length(p_operation_id) > 128
     or coalesce(btrim(p_barcode), '') = ''
     or char_length(p_barcode) > 64
     or p_intent not in ('checkout', 'return', 'quick_return')
     or p_expected_status not in ('available', 'checked_out') then
    raise exception 'Invalid offline checkout payload' using errcode = '22023';
  end if;
  if (
    p_intent = 'checkout'
    and (p_borrower_id is null or p_expected_status <> 'available'
      or p_expected_checked_out_by is not null)
  ) or (
    p_intent in ('return', 'quick_return')
    and (p_borrower_id is null or p_expected_status <> 'checked_out'
      or p_expected_checked_out_by is null
      or p_borrower_id is distinct from p_expected_checked_out_by)
  ) then
    raise exception 'Offline checkout intent does not match its snapshot' using errcode = '22023';
  end if;

  select profile.role into actor_role
  from public.profiles profile
  join public.workspaces workspace on workspace.id = profile.workspace_id
  where profile.id = p_profile_id
    and profile.workspace_id = p_workspace_id
    and profile.role in ('tenant_account', 'workspace_admin')
    and profile.is_active
    and profile.deleted_at is null
    and workspace.status = 'active';
  if actor_role is null then
    raise exception 'Offline checkout actor is not active' using errcode = '42501';
  end if;
  if p_intent = 'quick_return' and actor_role <> 'workspace_admin' then
    raise exception 'Quick Return requires a Workspace Admin' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.offline_checkout_packs pack
    where pack.id = p_pack_id
      and pack.workspace_id = p_workspace_id
      and pack.profile_id = p_profile_id
      and pack.device_id = p_device_id
      and pack.invalidated_at is null
      and exists (
        select 1 from public.account_sessions account_session
        where account_session.workspace_id = p_workspace_id
          and account_session.profile_id = p_profile_id
          and account_session.device_id = p_device_id
          and account_session.revoked_at is null
      )
  ) or not exists (
    select 1 from public.offline_checkout_pack_items packed_item
    where packed_item.pack_id = p_pack_id
      and packed_item.item_id = p_item_id
  ) then
    raise exception 'Offline checkout pack is not active' using errcode = '42501';
  end if;

  if p_force then
    if p_conflict_id is null or not exists (
      select 1
      from public.offline_checkout_conflicts conflict
      cross join lateral jsonb_array_elements(conflict.offline_payload) payload
      where conflict.id = p_conflict_id
        and conflict.pack_id = p_pack_id
        and conflict.workspace_id = p_workspace_id
        and conflict.profile_id = p_profile_id
        and conflict.device_id = p_device_id
        and conflict.operation_id = p_operation_id
        and conflict.status = 'pending'
        and payload ->> 'item_id' = p_item_id::text
        and payload ->> 'barcode' = p_barcode
        and payload ->> 'intent' = p_intent
        and coalesce(payload ->> 'borrower_id', '') = coalesce(p_borrower_id::text, '')
        and payload ->> 'expected_status' = p_expected_status
        and coalesce(payload ->> 'expected_checked_out_by', '') =
          coalesce(p_expected_checked_out_by::text, '')
    ) then
      raise exception 'Offline checkout conflict is not eligible for resolution' using errcode = '42501';
    end if;
  elsif p_conflict_id is not null then
    raise exception 'Unexpected offline checkout conflict' using errcode = '22023';
  end if;

  select item.* into item_row
  from public.items item
  where item.id = p_item_id
    and item.workspace_id = p_workspace_id
    and item.deleted_at is null
  for update;
  if not found or item_row.barcode is distinct from p_barcode then
    return jsonb_build_object('status', 'needs_review', 'reason', 'item_unavailable');
  end if;

  if actor_role = 'tenant_account'
     and item_row.access_mode <> 'all'
     and not exists (
       select 1 from public.item_access_grants grant_row
       where grant_row.item_id = p_item_id and grant_row.profile_id = p_profile_id
     ) then
    raise exception 'Offline item access changed' using errcode = '42501';
  end if;

  if p_intent = 'checkout' then
    if p_borrower_id is null or not exists (
      select 1 from public.borrowers borrower
      where borrower.id = p_borrower_id
        and borrower.workspace_id = p_workspace_id
        and borrower.deleted_at is null
        and (
          actor_role = 'workspace_admin'
          or borrower.access_mode = 'all'
          or exists (
            select 1 from public.borrower_access_grants grant_row
            where grant_row.borrower_id = borrower.id
              and grant_row.profile_id = p_profile_id
          )
        )
    ) then
      raise exception 'Offline borrower access changed' using errcode = '42501';
    end if;
    target_status := 'checked_out';
    target_borrower := p_borrower_id;
  else
    target_status := 'available';
    target_borrower := null;
  end if;

  log_borrower := coalesce(
    p_borrower_id,
    p_expected_checked_out_by,
    item_row.checked_out_by
  );
  if log_borrower is null or not exists (
    select 1 from public.borrowers borrower
    where borrower.id = log_borrower and borrower.workspace_id = p_workspace_id
  ) then
    raise exception 'Offline checkout log borrower is invalid' using errcode = '22023';
  end if;
  log_operation_id := p_operation_id || ':' || p_item_id::text || ':' || p_intent || ':offline';

  if lower(item_row.status) = target_status
     and item_row.checked_out_by is not distinct from target_borrower then
    insert into public.item_logs(
      workspace_id, item_id, checked_out_by, action_type, performed_by, operation_id
    ) values (
      p_workspace_id, p_item_id, log_borrower, p_intent, p_profile_id, log_operation_id
    ) on conflict (workspace_id, item_id, action_type, operation_id) do nothing;
    if p_intent = 'quick_return' then
      insert into public.admin_audit_logs(
        workspace_id, actor_id, action_type, entity_type, entity_id, metadata
      ) values (
        p_workspace_id,
        p_profile_id,
        'quick_return',
        null,
        null,
        jsonb_build_object(
          'count', 1,
          'barcodes', jsonb_build_array(p_barcode),
          'source', 'offline_replay',
          'operation_id', p_operation_id,
          'item_id', p_item_id
        )
      ) on conflict do nothing;
    end if;
    return jsonb_build_object('status', 'idempotent');
  end if;

  if not p_force and (
    lower(item_row.status) <> lower(p_expected_status)
    or item_row.checked_out_by is distinct from p_expected_checked_out_by
  ) then
    return jsonb_build_object(
      'status', 'needs_review',
      'reason', 'server_state_changed',
      'server_state', jsonb_build_object(
        'id', item_row.id,
        'name', item_row.name,
        'barcode', item_row.barcode,
        'status', item_row.status,
        'checked_out_by', item_row.checked_out_by
      )
    );
  end if;

  update public.items
  set status = target_status,
      checked_out_by = target_borrower,
      checked_out_at = case when target_status = 'checked_out' then now() else null end
  where id = p_item_id;

  insert into public.item_logs(
    workspace_id, item_id, checked_out_by, action_type, performed_by, operation_id
  ) values (
    p_workspace_id, p_item_id, log_borrower, p_intent, p_profile_id, log_operation_id
  ) on conflict (workspace_id, item_id, action_type, operation_id) do nothing;

  if p_intent = 'quick_return' then
    insert into public.admin_audit_logs(
      workspace_id, actor_id, action_type, entity_type, entity_id, metadata
    ) values (
      p_workspace_id,
      p_profile_id,
      'quick_return',
      null,
      null,
      jsonb_build_object(
        'count', 1,
        'barcodes', jsonb_build_array(p_barcode),
        'source', 'offline_replay',
        'operation_id', p_operation_id,
        'item_id', p_item_id
      )
    ) on conflict do nothing;
  end if;

  return jsonb_build_object('status', 'synced');
end;
$$;

-- These are Edge Function implementation tables, not browser Data API tables.
-- service_role bypasses RLS; no authenticated policy is intentionally present.
revoke all on public.offline_checkout_packs from public, anon, authenticated;
revoke all on public.offline_checkout_pack_items from public, anon, authenticated;
revoke all on public.offline_checkout_conflicts from public, anon, authenticated;
grant all on public.offline_checkout_packs to service_role;
grant all on public.offline_checkout_pack_items to service_role;
grant all on public.offline_checkout_conflicts to service_role;
revoke all on function public.apply_offline_checkout_item(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) from public, anon, authenticated;
grant execute on function public.apply_offline_checkout_item(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) to service_role;

commit;
