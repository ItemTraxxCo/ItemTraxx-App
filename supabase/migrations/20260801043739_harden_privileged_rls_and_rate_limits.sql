begin;

-- The provisioning migration previously installed a role-only fallback when
-- the step-up helper was absent. Keep the dependency explicit and make the
-- helper available on environments that missed the older helper migration.
do $$
begin
  if to_regclass('public.privileged_session_stepups') is null then
    raise exception
      'privileged_session_stepups is required before privileged RLS can be hardened';
  end if;
end
$$;

create or replace function public.current_session_binding_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(auth.jwt() ->> 'session_id', '') <> ''
      then 'session:' || (auth.jwt() ->> 'session_id')
    else null
  end;
$$;

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
      and s.expires_at > now()
  );
$$;

revoke all on function public.current_session_binding_key() from public, anon, authenticated;
grant execute on function public.current_session_binding_key() to authenticated, service_role;
revoke all on function public.has_recent_privileged_step_up(text) from public, anon, authenticated;
grant execute on function public.has_recent_privileged_step_up(text) to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.has_recent_privileged_step_up(text)') is null then
    raise exception 'privileged step-up helper was not installed';
  end if;
  if to_regprocedure('private.super_admin_session_not_revoked()') is null then
    raise exception 'super-admin session revocation helper is required';
  end if;
end
$$;

drop policy if exists "super_admin_select_sales_leads" on public.sales_leads;
create policy "super_admin_select_sales_leads"
  on public.sales_leads
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_active = true
        and p.role = 'super_admin'
    )
    and (select public.has_recent_privileged_step_up('super_admin'))
    and (select private.super_admin_session_not_revoked())
  );

drop policy if exists "super_admin_select_customer_status_logs"
  on public.customer_status_logs;
create policy "super_admin_select_customer_status_logs"
  on public.customer_status_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_active = true
        and p.role = 'super_admin'
    )
    and (select public.has_recent_privileged_step_up('super_admin'))
    and (select private.super_admin_session_not_revoked())
  );

-- Rate-limit scopes are server-selected. The caller may choose a stricter
-- p_limit, but cannot create a new namespace or choose a new bucket duration.
-- Expired rows are removed across every scope for this actor, keeping the
-- per-actor cardinality bounded by the finite scope set.
create or replace function public.consume_rate_limit(
  p_scope text,
  p_limit integer,
  p_window_seconds integer
) returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n timestamptz := now();
  actor uuid := auth.uid();
  workspace uuid := coalesce(public.current_workspace_id(), actor);
  requested_scope text := lower(trim(coalesce(p_scope, '')));
  seconds integer;
  policy_limit integer;
  maximum integer;
  bucket timestamptz;
  next_count integer;
begin
  if actor is null then
    raise exception 'Unauthorized';
  end if;

  case requested_scope
    when 'admin' then
      seconds := 60;
      policy_limit := 30;
    when 'workspace' then
      seconds := 60;
      policy_limit := 25;
    when 'super_admin' then
      seconds := 60;
      policy_limit := 60;
    when 'offline_checkout_prepare_pack' then
      seconds := 60;
      policy_limit := 3;
    when 'offline_checkout_sync' then
      seconds := 60;
      policy_limit := 20;
    when 'offline_checkout_resolve' then
      seconds := 60;
      policy_limit := 20;
    else
      raise exception 'Invalid rate-limit scope';
  end case;

  maximum := least(greatest(coalesce(p_limit, 0), 1), policy_limit);
  bucket := timestamptz 'epoch' +
    floor(extract(epoch from n) / seconds) * seconds * interval '1 second';

  delete from public.rate_limits
  where workspace_id = workspace
    and actor_id = actor
    and window_start < n - make_interval(secs => seconds);

  insert into public.rate_limits(
    workspace_id,
    actor_id,
    scope,
    window_start,
    count
  ) values (
    workspace,
    actor,
    requested_scope,
    bucket,
    1
  )
  on conflict(workspace_id, actor_id, scope, window_start)
  do update set count = public.rate_limits.count + 1
  where public.rate_limits.count < maximum
  returning count into next_count;

  if not found then
    return query
      select false,
        greatest(
          ceil(extract(epoch from bucket + make_interval(secs => seconds) - n))::integer,
          0
        );
  else
    return query select true, null::integer;
  end if;
end;
$$;

commit;
