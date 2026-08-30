begin;

-- Keep the existing item/replay transaction intact, but put the borrower
-- authorization check in a wrapper that runs in the same database statement.
-- The previous body is retained only as an owner-called implementation; it is
-- not executable by service_role or any browser role directly.
alter function public.apply_offline_checkout_item(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) rename to apply_offline_checkout_item_unchecked;

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
begin
  -- A forced conflict resolution must satisfy the same borrower grant as a
  -- fresh replay. Workspace admins retain their existing broad access, while
  -- tenant accounts must have an active borrower grant (or an all-access
  -- borrower). This check is inside the transaction before the locked,
  -- service-role implementation can mutate the item.
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
      and actor.role in ('tenant_account', 'workspace_admin')
      and actor.is_active
      and actor.deleted_at is null
      and workspace.status = 'active'
      and (
        actor.role = 'workspace_admin'
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

revoke all on function public.apply_offline_checkout_item_unchecked(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) from public, anon, authenticated, service_role;
revoke all on function public.apply_offline_checkout_item(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) from public, anon, authenticated;
grant execute on function public.apply_offline_checkout_item(
  uuid,uuid,text,uuid,text,uuid,text,text,uuid,text,uuid,uuid,boolean
) to service_role;

commit;
