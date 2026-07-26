begin;

-- create_borrower_identity is invoked exclusively via the service_role client
-- (admin-borrower-mutate edge function), so auth.uid() is NULL inside the
-- function. Writing granted_by = auth.uid() therefore recorded NULL for every
-- restricted-access grant, destroying the audit trail of which workspace_admin
-- authorized the grant (Strix CWE-778, medium).
--
-- Fix: accept the caller's already-resolved profile id as an optional
-- p_granted_by argument and prefer it over auth.uid(). The edge function passes
-- profile.id (the authenticated workspace_admin) after verifying the caller.
-- coalesce keeps backward compatibility for any future authenticated caller
-- that has an auth.uid() context.
--
-- The signature changes (extra parameter), so drop the old 5-arg function
-- first to avoid leaving a stale overload behind, then recreate and re-grant.
-- The service_role auth-skip logic from
-- 20260726020500_fix_create_borrower_identity_service_role_auth.sql is carried
-- forward unchanged so this redefinition does not regress that fix.
drop function if exists public.create_borrower_identity(uuid, text, text, text, uuid[]);

create or replace function public.create_borrower_identity(
  p_workspace_id uuid,
  p_username text,
  p_borrower_id text,
  p_access_mode text,
  p_profile_ids uuid[] default '{}'::uuid[],
  p_granted_by uuid default null
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
    select created_id, profile_id, coalesce(p_granted_by, (select auth.uid()))
    from unnest(p_profile_ids) profile_id;
  end if;
  return query
  select borrower.id, borrower.workspace_id, borrower.username,
    borrower.borrower_id, borrower.access_mode
  from public.borrowers borrower
  where borrower.id = created_id;
end;
$$;

revoke all on function public.create_borrower_identity(uuid, text, text, text, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.create_borrower_identity(uuid, text, text, text, uuid[], uuid) to service_role;

notify pgrst, 'reload schema';

commit;
