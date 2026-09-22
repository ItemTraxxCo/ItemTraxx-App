-- Better Auth is the source of truth for session validity. Keep the public
-- account-session display/revocation overlay synchronized in both directions
-- so a revoke from either surface cannot leave a stale active-device row.

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
  return old;
end;
$$;

revoke all on function private.revoke_account_sessions_for_better_auth_delete() from public, anon, authenticated;

drop trigger if exists sync_account_sessions_after_better_auth_delete on better_auth.session;
create trigger sync_account_sessions_after_better_auth_delete
after delete on better_auth.session
for each row
execute function private.revoke_account_sessions_for_better_auth_delete();

create or replace function private.delete_better_auth_session_for_account_revoke()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from better_auth.session
  where id = old.auth_session_id;
  return new;
end;
$$;

revoke all on function private.delete_better_auth_session_for_account_revoke() from public, anon, authenticated;

drop trigger if exists delete_better_auth_session_after_account_revoke on public.account_sessions;
create trigger delete_better_auth_session_after_account_revoke
after update of revoked_at on public.account_sessions
for each row
when (old.revoked_at is null and new.revoked_at is not null)
execute function private.delete_better_auth_session_for_account_revoke();

-- Reconcile rows created before the triggers and any revocations that were
-- applied while the two stores were out of sync. Missing or expired Better
-- Auth sessions are no longer active, and an explicitly revoked registry row
-- must not leave a live Better Auth session behind.
update public.account_sessions as account_session
set revoked_at = now()
where account_session.revoked_at is null
  and account_session.auth_session_id is not null
  and not exists (
    select 1
    from better_auth.session as better_auth_session
    where better_auth_session.id = account_session.auth_session_id
      and better_auth_session."expiresAt" > now()
  );

delete from better_auth.session as better_auth_session
where exists (
  select 1
  from public.account_sessions as account_session
  where account_session.auth_session_id = better_auth_session.id
    and account_session.revoked_at is not null
);
