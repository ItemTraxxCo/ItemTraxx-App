-- A super-admin JWT is valid only while its exact Better Auth session has a
-- corresponding active row in the privileged session registry.
create or replace function private.super_admin_session_not_revoked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.super_admin_sessions as registered_session
    join better_auth.session as auth_session
      on auth_session.id = registered_session.auth_session_id
    where registered_session.profile_id = (select auth.uid())
      and registered_session.auth_session_id = (select auth.jwt() ->> 'session_id')
      and registered_session.revoked_at is null
      and auth_session."expiresAt" > now()
  );
$$;

revoke all on function private.super_admin_session_not_revoked() from public, anon, authenticated;
grant execute on function private.super_admin_session_not_revoked() to authenticated, service_role;

-- Deleting a Better Auth session must revoke both application session
-- registries. This also makes existing JWTs fail the predicate immediately.
create or replace function private.revoke_account_sessions_for_better_auth_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_sessions
  set revoked_at = coalesce(revoked_at, now())
  where auth_session_id = old.id
    and revoked_at is null;

  update public.super_admin_sessions
  set revoked_at = coalesce(revoked_at, now())
  where auth_session_id = old.id
    and revoked_at is null;

  return old;
end;
$$;

revoke all on function private.revoke_account_sessions_for_better_auth_delete() from public, anon, authenticated;

-- Treat already deleted or expired Better Auth sessions as revoked during
-- rollout; active sessions without registry rows are rejected by the helper.
update public.super_admin_sessions as registered_session
set revoked_at = coalesce(registered_session.revoked_at, now())
where registered_session.revoked_at is null
  and registered_session.auth_session_id is not null
  and not exists (
    select 1
    from better_auth.session as auth_session
    where auth_session.id = registered_session.auth_session_id
      and auth_session."expiresAt" > now()
  );
