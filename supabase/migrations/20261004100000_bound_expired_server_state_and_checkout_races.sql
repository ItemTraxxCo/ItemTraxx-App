begin;

-- Remove expired offline packs after a short recovery grace period. Their
-- item, borrower, and conflict snapshots cascade with the parent row.
select cron.schedule(
  'itemtraxx-expired-offline-checkout-pack-retention',
  '17 * * * *',
  $job$
    delete from public.offline_checkout_packs
    where expires_at < now() - interval '7 days';
  $job$
);

-- Prelogin windows currently top out at one hour. Pruning all identities on a
-- schedule bounds abandoned IP-key rows even when the same caller never
-- returns to trigger per-key cleanup.
select cron.schedule(
  'itemtraxx-prelogin-rate-limit-retention',
  '*/10 * * * *',
  $job$
    delete from public.rate_limits_prelogin
    where window_start < now() - interval '1 hour';
  $job$
);

-- Checkout writes lock the item before this trigger locks the active
-- borrower. Borrower archival already owns the borrower row and checks item
-- state without locking items. This serializes both directions without a
-- borrower/item lock cycle: either checkout commits first and archive sees it,
-- or archive commits first and checkout observes an inactive borrower.
create or replace function private.lock_active_checkout_borrower()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  borrower_deleted_at timestamptz;
begin
  if new.checked_out_by is null
     or lower(coalesce(new.status, '')) <> 'checked_out' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.checked_out_by is not distinct from new.checked_out_by
     and lower(coalesce(old.status, '')) = 'checked_out' then
    return new;
  end if;

  select borrower.deleted_at
  into borrower_deleted_at
  from public.borrowers as borrower
  where borrower.id = new.checked_out_by
    and borrower.workspace_id = new.workspace_id
  for update;

  if not found or borrower_deleted_at is not null then
    raise exception 'Cannot check out an item to an inactive borrower.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.lock_active_checkout_borrower()
  from public, anon, authenticated;

drop trigger if exists lock_active_checkout_borrower on public.items;
create trigger lock_active_checkout_borrower
before insert or update of status, checked_out_by
on public.items
for each row
execute function private.lock_active_checkout_borrower();

create or replace function private.prevent_archiving_borrower_with_checkouts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null
     and new.deleted_at is not null
     and exists (
       select 1
       from public.items as item
       where item.workspace_id = old.workspace_id
         and item.checked_out_by = old.id
         and item.deleted_at is null
     ) then
    raise exception 'Return all checked-out items before archiving this borrower.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_archiving_borrower_with_checkouts()
  from public, anon, authenticated;

drop trigger if exists prevent_archiving_borrower_with_checkouts on public.borrowers;
create trigger prevent_archiving_borrower_with_checkouts
before update of deleted_at
on public.borrowers
for each row
execute function private.prevent_archiving_borrower_with_checkouts();

commit;
