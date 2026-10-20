create or replace function private.enforce_active_better_auth_workspace_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  -- Invitations that are canceled or rejected cannot grant access and must
  -- remain manageable after archive. Pending and accepted invitations can
  -- grant membership, so they must stay inside an active workspace.
  if tg_table_name = 'invitation' then
    -- Better Auth marks an invitation accepted before it creates the member.
    -- If member creation then fails (for example, because archiving won the
    -- race), it compensates by restoring accepted -> pending. Permit only that
    -- status rollback, with all invitation fields otherwise unchanged.
    if tg_op = 'UPDATE'
       and old.status = 'accepted'
       and new.status = 'pending'
       and new."organizationId" = old."organizationId"
       and (to_jsonb(new) - 'status' - 'updatedAt')
         is not distinct from (to_jsonb(old) - 'status' - 'updatedAt') then
      return new;
    end if;

    if new.status not in ('pending', 'accepted') then
      return new;
    end if;
  end if;

  -- FOR SHARE conflicts with the row lock taken by workspace status updates.
  -- This serializes membership grants with archive/suspend operations instead
  -- of relying on a request-time check that can race the workspace update.
  select w.id
    into v_workspace_id
  from public.workspaces as w
  where w.better_auth_organization_id = new."organizationId"
    and w.status = 'active'
    and w.archived_at is null
  for share;

  if not found then
    raise exception 'Better Auth organization requires an active workspace';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_active_workspace_lifecycle on better_auth.member;
create trigger enforce_active_workspace_lifecycle
before insert or update on better_auth.member
for each row execute function private.enforce_active_better_auth_workspace_lifecycle();

drop trigger if exists enforce_active_workspace_lifecycle on better_auth.invitation;
create trigger enforce_active_workspace_lifecycle
before insert or update on better_auth.invitation
for each row execute function private.enforce_active_better_auth_workspace_lifecycle();

revoke all on function private.enforce_active_better_auth_workspace_lifecycle()
  from public, anon, authenticated;
