begin;

-- jsonb_array_elements_text returns text values. Cast them to UUID before
-- inserting into offline_checkout_pack_borrowers.borrower_id.
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
  select p_pack_id, chunk.borrower_id::uuid
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

commit;
