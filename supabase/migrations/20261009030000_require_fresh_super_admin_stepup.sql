begin;

-- Super Admin grants are bound to one Better Auth session, but they must also
-- be recent. The Edge Functions use the same five-minute window. Preserve the
-- existing session-lifetime behavior for workspace and individual accounts.
create or replace function public.has_recent_privileged_step_up(p_role_scope text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_role_scope is not null and exists (
    select 1
    from public.privileged_session_stepups s
    where s.user_id = auth.uid()
      and s.role_scope = p_role_scope
      and s.binding_key = public.current_session_binding_key()
      and (
        p_role_scope <> 'super_admin'
        or (
          s.updated_at >= now() - interval '5 minutes'
          and s.updated_at <= now() + interval '30 seconds'
        )
      )
  );
$$;

revoke all on function public.has_recent_privileged_step_up(text)
  from public, anon, authenticated;
grant execute on function public.has_recent_privileged_step_up(text)
  to authenticated, service_role;

commit;
