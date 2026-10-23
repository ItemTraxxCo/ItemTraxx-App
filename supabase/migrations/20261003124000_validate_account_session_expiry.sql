begin;

-- Keep Better Auth's private session table outside the PostgREST schema list.
-- Account token consumers use this narrow, service-role-only predicate to
-- reject JWTs whose backing Better Auth session has expired or been deleted.
create or replace function public.is_better_auth_session_active(
  p_session_id text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from better_auth.session as auth_session
    where auth_session.id = p_session_id
      and auth_session."expiresAt" > now()
  );
$$;

revoke all on function public.is_better_auth_session_active(text)
  from public, anon, authenticated;
grant execute on function public.is_better_auth_session_active(text)
  to service_role;

notify pgrst, 'reload schema';

commit;
