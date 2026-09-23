begin;

-- A privileged grant is bound to a Better Auth session and remains valid for
-- that session's lifetime. Session expiry, account status, and revocation
-- checks continue to control access.
alter table public.privileged_session_stepups
  alter column expires_at drop not null;

-- Existing 15-minute grants should not continue to impose the old limit after
-- this migration is deployed.
update public.privileged_session_stepups
set expires_at = null
where expires_at is not null;

-- Keep this function name because existing RLS policies depend on it. The
-- session binding remains required; the stored expiry is no longer an access
-- gate, including during a rolling deploy with an older caller.
create or replace function public.has_recent_privileged_step_up(p_role_scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.privileged_session_stepups s
    where s.user_id = auth.uid()
      and s.role_scope = p_role_scope
      and s.binding_key = public.current_session_binding_key()
  );
$$;

revoke all on function public.has_recent_privileged_step_up(text)
  from public, anon, authenticated;
grant execute on function public.has_recent_privileged_step_up(text)
  to authenticated, service_role;

commit;
