-- Preserve offline conflict resolution, but check the borrower currently
-- assigned to the item while holding the same row lock used by the mutation.
begin;

create or replace function public.apply_offline_checkout_item(
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
  current_checkout_borrower uuid;
begin
  if not exists (
    select 1
    from public.offline_checkout_packs pack
    where pack.id = p_pack_id
      and pack.workspace_id = p_workspace_id
      and pack.profile_id = p_profile_id
      and pack.device_id = p_device_id
      and pack.invalidated_at is null
      and pack.expires_at > now()
  ) then
    raise exception 'Offline checkout pack is expired' using errcode = '42501';
  end if;

  if p_intent in ('checkout', 'return', 'quick_return') and not exists (
    select 1
    from public.profiles actor
    join public.workspaces workspace
      on workspace.id = actor.workspace_id
    join public.borrowers borrower
      on borrower.id = p_borrower_id
     and borrower.workspace_id = p_workspace_id
     and borrower.deleted_at is null
    where actor.id = p_profile_id
      and actor.workspace_id = p_workspace_id
      and actor.role in ('tenant_account', 'workspace_admin', 'individual_account')
      and actor.is_active
      and actor.deleted_at is null
      and workspace.status = 'active'
      and (
        actor.role in ('workspace_admin', 'individual_account')
        or borrower.access_mode = 'all'
        or exists (
          select 1
          from public.borrower_access_grants grant_row
          where grant_row.borrower_id = borrower.id
            and grant_row.profile_id = p_profile_id
        )
      )
  ) then
    raise exception 'Offline borrower access changed' using errcode = '42501';
  end if;

  if p_force then
    select item.checked_out_by
      into current_checkout_borrower
    from public.items item
    where item.id = p_item_id
      and item.workspace_id = p_workspace_id
      and item.deleted_at is null
    for update;

    if not found then
      raise exception 'Offline item is unavailable' using errcode = '42501';
    end if;

    if current_checkout_borrower is not null and not exists (
      select 1
      from public.profiles actor
      join public.workspaces workspace
        on workspace.id = actor.workspace_id
      join public.borrowers borrower
        on borrower.id = current_checkout_borrower
       and borrower.workspace_id = p_workspace_id
       and borrower.deleted_at is null
      where actor.id = p_profile_id
        and actor.workspace_id = p_workspace_id
        and actor.is_active
        and actor.deleted_at is null
        and workspace.status = 'active'
        and (
          actor.role in ('workspace_admin', 'individual_account')
          or (
            actor.role = 'tenant_account'
            and (
              borrower.access_mode = 'all'
              or exists (
                select 1
                from public.borrower_access_grants grant_row
                where grant_row.borrower_id = borrower.id
                  and grant_row.profile_id = p_profile_id
              )
            )
          )
        )
    ) then
      raise exception 'Offline current borrower access changed' using errcode = '42501';
    end if;
  end if;

  return public.apply_offline_checkout_item_unchecked(
    p_workspace_id,
    p_profile_id,
    p_device_id,
    p_pack_id,
    p_operation_id,
    p_item_id,
    p_barcode,
    p_intent,
    p_borrower_id,
    p_expected_status,
    p_expected_checked_out_by,
    p_conflict_id,
    p_force
  );
end;
$$;

revoke all on function public.apply_offline_checkout_item(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) from public, anon, authenticated;
grant execute on function public.apply_offline_checkout_item(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) to service_role;

commit;
