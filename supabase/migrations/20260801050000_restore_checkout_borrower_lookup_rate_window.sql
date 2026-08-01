begin;

-- Keep the high-volume checkout borrower lookup at its existing 20 requests
-- per 30 seconds without reopening caller-controlled rate-limit scopes.
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
    when 'checkout_borrower_lookup' then
      seconds := 30;
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
