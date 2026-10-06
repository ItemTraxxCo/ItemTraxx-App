begin;

-- The status endpoint now uses a fixed direct-request key. Remove expired rows
-- left by the older caller-rotatable direct identities and keep all status
-- limiter history scoped to the active rate-limit window.
create index if not exists idx_rate_limits_prelogin_scope_expiry
  on public.rate_limits_prelogin(scope, window_start);
create index if not exists idx_rate_limits_prelogin_window_expiry
  on public.rate_limits_prelogin(window_start);

delete from public.rate_limits_prelogin
where scope in (
  'system-status-direct',
  'system-status-edge',
  'system-status-direct-global'
)
  and window_start < now() - interval '60 seconds';

create or replace function public.consume_rate_limit_prelogin(
  p_key text,
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
  requested_key text := trim(coalesce(p_key, ''));
  requested_scope text := trim(coalesce(p_scope, ''));
  seconds integer := greatest(coalesce(p_window_seconds, 0), 1);
  maximum integer := greatest(coalesce(p_limit, 0), 1);
  bucket timestamptz := timestamptz 'epoch' +
    floor(extract(epoch from n) / seconds) * seconds * interval '1 second';
  next_count integer;
begin
  if requested_key = '' or requested_scope = '' then
    raise exception 'Invalid prelogin rate-limit identity';
  end if;

  -- Public IP-scoped identities may never be reused. Expire their rows
  -- globally after the longest prelogin window (one hour) instead of leaving
  -- abandoned identities behind until that same IP returns.
  delete from public.rate_limits_prelogin
  where window_start < n - interval '1 hour';

  if requested_scope in (
    'system-status-direct',
    'system-status-edge',
    'system-status-direct-global'
  ) then
    delete from public.rate_limits_prelogin
    where scope in (
      'system-status-direct',
      'system-status-edge',
      'system-status-direct-global'
    )
      and window_start < n - make_interval(secs => seconds);
  else
    delete from public.rate_limits_prelogin
    where rate_key = requested_key
      and scope = requested_scope
      and window_start < n - make_interval(secs => seconds);
  end if;

  insert into public.rate_limits_prelogin(rate_key, scope, window_start, count)
  values (requested_key, requested_scope, bucket, 1)
  on conflict(rate_key, scope, window_start)
  do update set count = public.rate_limits_prelogin.count + 1
  where public.rate_limits_prelogin.count < maximum
  returning count into next_count;

  if not found then
    return query select false,
      greatest(
        ceil(extract(epoch from bucket + make_interval(secs => seconds) - n))::integer,
        0
      );
  else
    return query select true, null::integer;
  end if;
end;
$$;

revoke all on function public.consume_rate_limit_prelogin(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit_prelogin(text, text, integer, integer)
  to service_role;

commit;
