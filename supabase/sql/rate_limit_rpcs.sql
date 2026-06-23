create index if not exists idx_rate_limits_lookup
  on public.rate_limits (tenant_id, actor_id, scope, window_start desc);

create index if not exists idx_rate_limits_prelogin_lookup
  on public.rate_limits_prelogin (rate_key, scope, window_start desc);

drop function if exists public.consume_rate_limit(text, integer, integer);

create or replace function public.consume_rate_limit(
  p_scope text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_actor_id uuid := auth.uid();
  v_tenant_id uuid := coalesce(public.current_tenant_id(), v_actor_id);
  v_scope text := trim(p_scope);
  v_window_seconds integer := greatest(coalesce(p_window_seconds, 0), 1);
  v_limit integer := greatest(coalesce(p_limit, 0), 1);
  v_cutoff timestamptz := v_now - make_interval(secs => v_window_seconds);
  v_rate_limit public.rate_limits%rowtype;
  v_retry_after integer;
begin
  if v_actor_id is null then
    raise exception 'Unauthorized';
  end if;

  if v_scope = '' then
    raise exception 'Rate limit scope required';
  end if;

  delete from public.rate_limits
  where tenant_id = v_tenant_id
    and actor_id = v_actor_id
    and scope = v_scope
    and window_start < v_cutoff;

  select *
  into v_rate_limit
  from public.rate_limits
  where tenant_id = v_tenant_id
    and actor_id = v_actor_id
    and scope = v_scope
    and window_start >= v_cutoff
  order by window_start desc
  limit 1
  for update;

  if not found then
    insert into public.rate_limits (
      tenant_id,
      actor_id,
      scope,
      window_start,
      count
    ) values (
      v_tenant_id,
      v_actor_id,
      v_scope,
      v_now,
      1
    );

    return query select true, null::integer;
    return;
  end if;

  if v_rate_limit.count >= v_limit then
    v_retry_after := greatest(
      ceil(extract(epoch from ((v_rate_limit.window_start + make_interval(secs => v_window_seconds)) - v_now)))::integer,
      0
    );
    return query select false, v_retry_after;
    return;
  end if;

  update public.rate_limits
  set count = v_rate_limit.count + 1
  where tenant_id = v_rate_limit.tenant_id
    and actor_id = v_rate_limit.actor_id
    and scope = v_rate_limit.scope
    and window_start = v_rate_limit.window_start;

  return query select true, null::integer;
end;
$$;

drop function if exists public.consume_rate_limit_prelogin(text, text, integer, integer);

create or replace function public.consume_rate_limit_prelogin(
  p_key text,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_rate_key text := trim(p_key);
  v_scope text := trim(p_scope);
  v_window_seconds integer := greatest(coalesce(p_window_seconds, 0), 1);
  v_limit integer := greatest(coalesce(p_limit, 0), 1);
  v_cutoff timestamptz := v_now - make_interval(secs => v_window_seconds);
  v_rate_limit public.rate_limits_prelogin%rowtype;
  v_retry_after integer;
begin
  if v_rate_key = '' then
    raise exception 'Rate limit key required';
  end if;

  if v_scope = '' then
    raise exception 'Rate limit scope required';
  end if;

  delete from public.rate_limits_prelogin
  where rate_key = v_rate_key
    and scope = v_scope
    and window_start < v_cutoff;

  select *
  into v_rate_limit
  from public.rate_limits_prelogin
  where rate_key = v_rate_key
    and scope = v_scope
    and window_start >= v_cutoff
  order by window_start desc
  limit 1
  for update;

  if not found then
    insert into public.rate_limits_prelogin (
      rate_key,
      scope,
      window_start,
      count
    ) values (
      v_rate_key,
      v_scope,
      v_now,
      1
    );

    return query select true, null::integer;
    return;
  end if;

  if v_rate_limit.count >= v_limit then
    v_retry_after := greatest(
      ceil(extract(epoch from ((v_rate_limit.window_start + make_interval(secs => v_window_seconds)) - v_now)))::integer,
      0
    );
    return query select false, v_retry_after;
    return;
  end if;

  update public.rate_limits_prelogin
  set count = v_rate_limit.count + 1
  where rate_key = v_rate_limit.rate_key
    and scope = v_rate_limit.scope
    and window_start = v_rate_limit.window_start;

  return query select true, null::integer;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_rate_limit_prelogin(text, text, integer, integer) from public;

grant execute on function public.consume_rate_limit(text, integer, integer)
  to authenticated, service_role;

grant execute on function public.consume_rate_limit_prelogin(text, text, integer, integer)
  to anon, authenticated, service_role;
