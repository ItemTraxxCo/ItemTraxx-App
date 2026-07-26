begin;

-- create_borrower_identity's execute grant was tightened to service_role only
-- in 20260725210000_workspace_model_security_hardening.sql, but the function
-- body still required auth.uid() (via current_workspace_id()/current_user_role()/
-- current_account_session_is_active()) to be present. service_role calls have
-- no auth.uid(), so every invocation raised "Unauthorized" regardless of caller.
-- The admin-borrower-mutate edge function already verifies the caller is the
-- correct workspace_admin with an active device session before invoking this
-- RPC via the service_role client, so the auth.uid()-based re-check is
-- redundant (and broken) for that path. Skip it when caller_role is
-- service_role; keep it intact for any other caller.
create or replace function public.create_borrower_identity(
  p_workspace_id uuid,
  p_username text,
  p_borrower_id text,
  p_access_mode text,
  p_profile_ids uuid[] default '{}'::uuid[]
)
returns table(
  id uuid,
  workspace_id uuid,
  username text,
  borrower_id text,
  access_mode text
)
language plpgsql security definer
set search_path = ''
as $$
declare
  normalized_username text := coalesce(trim(p_username), '');
  normalized_borrower_id text := upper(coalesce(trim(p_borrower_id), ''));
  created_id uuid;
  caller_role text := (select current_setting('role', true));
begin
  if p_workspace_id is null then
    raise exception 'Unauthorized';
  end if;
  if caller_role is distinct from 'service_role' then
    if p_workspace_id <> (select public.current_workspace_id())
       or (select public.current_user_role()) <> 'workspace_admin'
       or not (select private.current_account_session_is_active()) then
      raise exception 'Unauthorized';
    end if;
  end if;
  if p_access_mode not in ('all', 'restricted')
     or (p_access_mode = 'restricted' and cardinality(p_profile_ids) = 0) then
    raise exception 'Access choice is required' using errcode = '22023';
  end if;
  if normalized_username = '' or normalized_borrower_id = '' then
    raise exception 'Borrower identity is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':borrower_id:' || normalized_borrower_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':username:' || lower(normalized_username), 0));
  insert into public.borrowers(workspace_id, username, borrower_id, access_mode)
  values (p_workspace_id, normalized_username, normalized_borrower_id, p_access_mode)
  returning borrowers.id into created_id;
  if p_access_mode = 'restricted' then
    if exists (
      select 1
      from unnest(p_profile_ids) target(profile_id)
      left join public.profiles profile on profile.id = target.profile_id
      where profile.id is null
        or profile.workspace_id <> p_workspace_id
        or profile.role <> 'tenant_account'
        or not profile.is_active
        or profile.deleted_at is not null
    ) then
      raise exception 'Invalid Tenant Account grant' using errcode = '22023';
    end if;
    insert into public.borrower_access_grants(borrower_id, profile_id, granted_by)
    select created_id, profile_id, (select auth.uid())
    from unnest(p_profile_ids) profile_id;
  end if;
  return query
  select borrower.id, borrower.workspace_id, borrower.username,
    borrower.borrower_id, borrower.access_mode
  from public.borrowers borrower
  where borrower.id = created_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
