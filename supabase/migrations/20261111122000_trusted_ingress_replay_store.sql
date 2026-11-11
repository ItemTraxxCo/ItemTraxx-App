-- Shared replay store for trusted edge ingress.
--
-- Each Edge Function isolate keeps its own in-memory replay cache, so a signed
-- envelope replayed to a different isolate inside the 30-second signature
-- window was accepted. This table gives all isolates one claim set. Edge
-- Functions call the RPC only after the in-memory claim succeeds, and only when
-- ITX_TRUSTED_INGRESS_REPLAY_STORE=database.
create table if not exists private.trusted_ingress_replay_claims (
  claim_key text primary key
    check (claim_key ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);

create index if not exists trusted_ingress_replay_claims_expires_at_idx
  on private.trusted_ingress_replay_claims (expires_at);

alter table private.trusted_ingress_replay_claims enable row level security;
revoke all on table private.trusted_ingress_replay_claims
  from public, anon, authenticated, service_role;

-- Returns true when the caller claimed the envelope, false when an unexpired
-- claim already exists (a replay). The insert is atomic, so concurrent claims
-- from different isolates resolve to exactly one winner.
create or replace function public.claim_trusted_ingress_request(
  p_claim_key text,
  p_ttl_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean;
begin
  if p_claim_key is null or p_claim_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid trusted ingress claim key' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 300 then
    raise exception 'invalid trusted ingress claim ttl' using errcode = '22023';
  end if;

  -- Bounded opportunistic purge keeps the table small without a cron job.
  delete from private.trusted_ingress_replay_claims
  where claim_key in (
    select claim_key
    from private.trusted_ingress_replay_claims
    where expires_at < now()
    limit 200
  );

  insert into private.trusted_ingress_replay_claims as claims (claim_key, expires_at)
  values (p_claim_key, now() + make_interval(secs => p_ttl_seconds))
  on conflict (claim_key) do update
    set expires_at = excluded.expires_at
    where claims.expires_at < now()
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_trusted_ingress_request(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_trusted_ingress_request(text, integer)
  to service_role;

-- Supabase migrations are forward-only. Manual rollback, after disabling
-- ITX_TRUSTED_INGRESS_REPLAY_STORE=database on every Edge Function:
-- drop function if exists public.claim_trusted_ingress_request(text, integer);
-- drop table if exists private.trusted_ingress_replay_claims;
