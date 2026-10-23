begin;

-- Store only a one-way fingerprint. The unique key makes redemption atomic
-- across concurrent requests and shared by both public form endpoints.
create table private.turnstile_token_redemptions (
  token_hash text primary key
    check (token_hash ~ '^[0-9a-f]{64}$'),
  redeemed_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > redeemed_at)
);

create index turnstile_token_redemptions_expires_at_idx
  on private.turnstile_token_redemptions (expires_at);

alter table private.turnstile_token_redemptions enable row level security;
revoke all on table private.turnstile_token_redemptions
  from public, anon, authenticated, service_role;

create or replace function public.consume_turnstile_token(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_hash text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_token_hash, '')));
  now_at timestamptz := pg_catalog.clock_timestamp();
  claimed_hash text;
begin
  if requested_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  insert into private.turnstile_token_redemptions (
    token_hash,
    redeemed_at,
    expires_at
  ) values (
    requested_hash,
    now_at,
    now_at + interval '10 minutes'
  )
  on conflict (token_hash) do update
    set redeemed_at = excluded.redeemed_at,
        expires_at = excluded.expires_at
    where private.turnstile_token_redemptions.expires_at <= now_at
  returning token_hash into claimed_hash;

  return claimed_hash is not null;
end;
$$;

revoke all on function public.consume_turnstile_token(text)
  from public, anon, authenticated;
grant execute on function public.consume_turnstile_token(text)
  to service_role;

select cron.schedule(
  'itemtraxx-turnstile-token-retention',
  '*/10 * * * *',
  $job$
    delete from private.turnstile_token_redemptions
    where expires_at <= now();
  $job$
);

notify pgrst, 'reload schema';

commit;
