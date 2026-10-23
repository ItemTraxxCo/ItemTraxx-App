begin;

-- Existing packs were fully materialized by the original single-response flow.
-- New preparations start incomplete and become usable only after the Edge
-- Function has persisted and verified every chunk.
alter table public.offline_checkout_packs
  add column download_complete boolean not null default true,
  add column downloaded_bytes integer not null default 0
    check (downloaded_bytes between 0 and 26214400);

create table public.offline_checkout_pack_borrowers (
  pack_id uuid not null references public.offline_checkout_packs(id) on delete cascade,
  borrower_id uuid not null references public.borrowers(id) on delete cascade,
  primary key (pack_id, borrower_id)
);

alter table public.offline_checkout_pack_borrowers enable row level security;
revoke all on public.offline_checkout_pack_borrowers from public, anon, authenticated;
grant all on public.offline_checkout_pack_borrowers to service_role;

create or replace function public.store_offline_checkout_pack_chunk(
  p_pack_id uuid,
  p_workspace_id uuid,
  p_profile_id uuid,
  p_device_id text,
  p_items jsonb,
  p_borrower_ids jsonb,
  p_chunk_bytes integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  pack_row public.offline_checkout_packs%rowtype;
  stored_item_count integer;
  stored_borrower_count integer;
  new_item_count integer;
  new_borrower_count integer;
  item_chunk_size integer;
  borrower_chunk_size integer;
begin
  if p_pack_id is null or p_workspace_id is null or p_profile_id is null
     or coalesce(btrim(p_device_id), '') = '' or char_length(p_device_id) > 128
     or p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or p_borrower_ids is null or jsonb_typeof(p_borrower_ids) is distinct from 'array'
     or p_chunk_bytes is null or p_chunk_bytes < 0 or p_chunk_bytes > 1048576 then
    raise exception 'Invalid offline pack chunk' using errcode = '22023';
  end if;

  item_chunk_size := jsonb_array_length(p_items);
  borrower_chunk_size := jsonb_array_length(p_borrower_ids);
  if item_chunk_size > 100 or borrower_chunk_size > 100 then
    raise exception 'Offline pack chunk is too large' using errcode = '22023';
  end if;

  select * into pack_row
  from public.offline_checkout_packs
  where id = p_pack_id
    and workspace_id = p_workspace_id
    and profile_id = p_profile_id
    and device_id = p_device_id
  for update;

  if not found or pack_row.invalidated_at is not null
     or pack_row.expires_at <= now() or pack_row.download_complete then
    raise exception 'Offline pack is not available for chunk transfer' using errcode = '42501';
  end if;
  if pack_row.item_count + pack_row.borrower_count > 10000 then
    raise exception 'Offline pack exceeds the server safety limit' using errcode = '22023';
  end if;

  select count(*)::integer into stored_item_count
  from public.offline_checkout_pack_items where pack_id = p_pack_id;
  select count(*)::integer into stored_borrower_count
  from public.offline_checkout_pack_borrowers where pack_id = p_pack_id;
  select count(*)::integer into new_item_count
  from (
    select distinct chunk.item_id
    from jsonb_to_recordset(p_items) as chunk(item_id uuid)
  ) incoming
  where not exists (
    select 1 from public.offline_checkout_pack_items current_rows
    where current_rows.pack_id = p_pack_id and current_rows.item_id = incoming.item_id
  );
  select count(*)::integer into new_borrower_count
  from (
    select distinct chunk.borrower_id::uuid as borrower_id
    from jsonb_array_elements_text(p_borrower_ids) as chunk(borrower_id)
  ) incoming
  where not exists (
    select 1 from public.offline_checkout_pack_borrowers current_rows
    where current_rows.pack_id = p_pack_id and current_rows.borrower_id = incoming.borrower_id
  );
  if stored_item_count + new_item_count > pack_row.item_count
     or stored_borrower_count + new_borrower_count > pack_row.borrower_count then
    raise exception 'Offline pack chunk exceeds its declared size' using errcode = '22023';
  end if;
  if (new_item_count > 0 or new_borrower_count > 0)
     and (p_chunk_bytes = 0 or pack_row.downloaded_bytes + p_chunk_bytes > 26214400) then
    raise exception 'Offline pack exceeds the server byte limit' using errcode = '22023';
  end if;

  insert into public.offline_checkout_pack_items(
    pack_id, item_id, snapshot_status, snapshot_checked_out_by
  )
  select p_pack_id, chunk.item_id, chunk.snapshot_status, chunk.snapshot_checked_out_by
  from jsonb_to_recordset(p_items) as chunk(
    item_id uuid,
    snapshot_status text,
    snapshot_checked_out_by uuid
  )
  on conflict (pack_id, item_id) do nothing;

  insert into public.offline_checkout_pack_borrowers(pack_id, borrower_id)
  select p_pack_id, borrower_id
  from jsonb_array_elements_text(p_borrower_ids) as chunk(borrower_id)
  on conflict (pack_id, borrower_id) do nothing;

  select count(*)::integer into stored_item_count
  from public.offline_checkout_pack_items where pack_id = p_pack_id;
  select count(*)::integer into stored_borrower_count
  from public.offline_checkout_pack_borrowers where pack_id = p_pack_id;
  if stored_item_count > pack_row.item_count
     or stored_borrower_count > pack_row.borrower_count then
    raise exception 'Offline pack chunk exceeds its declared size' using errcode = '22023';
  end if;
  if new_item_count > 0 or new_borrower_count > 0 then
    update public.offline_checkout_packs
    set downloaded_bytes = downloaded_bytes + p_chunk_bytes
    where id = p_pack_id;
  end if;

  return true;
end;
$$;

revoke all on function public.store_offline_checkout_pack_chunk(uuid, uuid, uuid, text, jsonb, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.store_offline_checkout_pack_chunk(uuid, uuid, uuid, text, jsonb, jsonb, integer)
  to service_role;

create or replace function public.complete_offline_checkout_pack(
  p_pack_id uuid,
  p_workspace_id uuid,
  p_profile_id uuid,
  p_device_id text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  pack_row public.offline_checkout_packs%rowtype;
  stored_item_count integer;
  stored_borrower_count integer;
begin
  if p_pack_id is null or p_workspace_id is null or p_profile_id is null
     or coalesce(btrim(p_device_id), '') = '' or char_length(p_device_id) > 128 then
    raise exception 'Invalid offline pack completion request' using errcode = '22023';
  end if;

  select * into pack_row
  from public.offline_checkout_packs
  where id = p_pack_id
    and workspace_id = p_workspace_id
    and profile_id = p_profile_id
    and device_id = p_device_id
  for update;

  if not found or pack_row.invalidated_at is not null
     or pack_row.expires_at <= now() then
    raise exception 'Offline pack is not available for completion' using errcode = '42501';
  end if;

  if pack_row.item_count + pack_row.borrower_count > 10000
     or pack_row.downloaded_bytes > 26214400 then
    raise exception 'Offline pack exceeds the server safety limit' using errcode = '22023';
  end if;

  select count(*)::integer into stored_item_count
  from public.offline_checkout_pack_items
  where pack_id = p_pack_id;
  select count(*)::integer into stored_borrower_count
  from public.offline_checkout_pack_borrowers
  where pack_id = p_pack_id;

  if stored_item_count <> pack_row.item_count
     or stored_borrower_count <> pack_row.borrower_count then
    raise exception 'Offline pack contents are incomplete' using errcode = '23514';
  end if;

  if not pack_row.download_complete then
    update public.offline_checkout_packs
    set download_complete = true
    where id = p_pack_id;
  end if;

  return true;
end;
$$;

revoke all on function public.complete_offline_checkout_pack(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_offline_checkout_pack(uuid, uuid, uuid, text)
  to service_role;

-- Keep request limits server-owned. A pack is at most 10,000 total records and
-- 25 MiB of serialized record arrays; transfer chunks contain at most 100 rows per collection, so 120 chunk
-- requests per minute permits a complete capped download without opening a
-- caller-controlled high-volume scope.
create or replace function public.consume_rate_limit(
  p_scope text,
  p_limit integer,
  p_window_seconds integer
) returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n timestamptz := now();
  actor uuid := auth.uid();
  workspace uuid := coalesce(public.current_workspace_id(), actor);
  requested_scope text := lower(trim(coalesce(p_scope, '')));
  seconds integer;
  policy_limit integer;
  maximum integer;
  bucket timestamptz;
  next_count integer;
begin
  if actor is null then
    raise exception 'Unauthorized';
  end if;

  case requested_scope
    when 'admin' then seconds := 60; policy_limit := 30;
    when 'workspace' then seconds := 60; policy_limit := 25;
    when 'super_admin' then seconds := 60; policy_limit := 60;
    when 'offline_checkout_prepare_pack' then seconds := 60; policy_limit := 3;
    when 'offline_checkout_prepare_pack_chunk' then seconds := 60; policy_limit := 120;
    when 'offline_checkout_complete_pack' then seconds := 60; policy_limit := 3;
    when 'offline_checkout_activate_pack' then seconds := 60; policy_limit := 3;
    when 'offline_checkout_cancel_pack' then seconds := 60; policy_limit := 10;
    when 'offline_checkout_sync' then seconds := 60; policy_limit := 20;
    when 'offline_checkout_resolve' then seconds := 60; policy_limit := 20;
    when 'checkout_borrower_lookup' then seconds := 30; policy_limit := 20;
    else raise exception 'Invalid rate-limit scope';
  end case;

  maximum := least(greatest(coalesce(p_limit, 0), 1), policy_limit);
  bucket := timestamptz 'epoch' +
    floor(extract(epoch from n) / seconds) * seconds * interval '1 second';

  delete from public.rate_limits
  where workspace_id = workspace
    and actor_id = actor
    and window_start < n - make_interval(secs => seconds);

  insert into public.rate_limits(workspace_id, actor_id, scope, window_start, count)
  values (workspace, actor, requested_scope, bucket, 1)
  on conflict(workspace_id, actor_id, scope, window_start)
  do update set count = public.rate_limits.count + 1
  where public.rate_limits.count < maximum
  returning count into next_count;

  if not found then
    return query select false,
      greatest(
        ceil(extract(epoch from bucket + make_interval(secs => seconds) - n))::integer,
        0
      );
  else
    return query select true, null::integer;
  end if;
end;
$$;

commit;
