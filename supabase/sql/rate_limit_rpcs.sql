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
  v_window_bucket timestamptz := timestamptz 'epoch' +
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds * interval '1 second';
  v_cutoff timestamptz := v_now - make_interval(secs => v_window_seconds);
  v_next_count integer;
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
    v_window_bucket,
    1
  )
  on conflict (tenant_id, actor_id, scope, window_start)
  do update
    set count = public.rate_limits.count + 1
  where public.rate_limits.count < v_limit
  returning count into v_next_count;

  if not found then
    v_retry_after := greatest(
      ceil(extract(epoch from ((v_window_bucket + make_interval(secs => v_window_seconds)) - v_now)))::integer,
      0
    );
    return query select false, v_retry_after;
    return;
  end if;

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
  v_window_bucket timestamptz := timestamptz 'epoch' +
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds * interval '1 second';
  v_cutoff timestamptz := v_now - make_interval(secs => v_window_seconds);
  v_next_count integer;
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

  insert into public.rate_limits_prelogin (
    rate_key,
    scope,
    window_start,
    count
  ) values (
    v_rate_key,
    v_scope,
    v_window_bucket,
    1
  )
  on conflict (rate_key, scope, window_start)
  do update
    set count = public.rate_limits_prelogin.count + 1
  where public.rate_limits_prelogin.count < v_limit
  returning count into v_next_count;

  if not found then
    v_retry_after := greatest(
      ceil(extract(epoch from ((v_window_bucket + make_interval(secs => v_window_seconds)) - v_now)))::integer,
      0
    );
    return query select false, v_retry_after;
    return;
  end if;

  return query select true, null::integer;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_rate_limit_prelogin(text, text, integer, integer) from public;

grant execute on function public.consume_rate_limit(text, integer, integer)
  to authenticated, service_role;

grant execute on function public.consume_rate_limit_prelogin(text, text, integer, integer)
  to anon, authenticated, service_role;
