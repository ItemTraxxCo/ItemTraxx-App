-- Keep Better Auth as the source of session validity while applying the
-- application session registry as a revocation overlay. A row is not required
-- for a fresh login because the destination workspace origin registers it
-- after the cross-origin handoff.
create or replace function private.current_account_session_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select public.current_user_role()) = 'super_admin'
      then exists (
        select 1
        from better_auth.session s
        join public.profiles p on p.better_auth_user_id = s."userId"
        where p.id = (select auth.uid())
          and p.is_active
          and p.deleted_at is null
          and s.id = (select auth.jwt() ->> 'session_id')
          and s."expiresAt" > now()
      ) and (select private.super_admin_session_not_revoked())
    else exists (
      select 1
      from better_auth.session s
      join public.profiles p on p.better_auth_user_id = s."userId"
      join public.workspaces w on w.id = p.workspace_id
      where p.id = (select auth.uid())
        and p.is_active
        and p.deleted_at is null
        and w.status = 'active'
        and s.id = (select auth.jwt() ->> 'session_id')
        and s."expiresAt" > now()
        and not exists (
          select 1
          from public.account_sessions a
          where a.workspace_id = p.workspace_id
            and a.profile_id = p.id
            and a.auth_session_id = s.id
            and a.revoked_at is not null
        )
    )
  end;
$$;

revoke all on function private.current_account_session_is_active() from public, anon, authenticated;
grant execute on function private.current_account_session_is_active() to authenticated, service_role;
