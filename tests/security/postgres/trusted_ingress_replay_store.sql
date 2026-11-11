\set ON_ERROR_STOP on
begin;

-- Browser roles must not be able to claim or probe ingress envelopes.
do $$
begin
  if has_function_privilege('anon', 'public.claim_trusted_ingress_request(text, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_trusted_ingress_request(text, integer)', 'EXECUTE') then
    raise exception 'browser role can execute claim_trusted_ingress_request';
  end if;
  if not has_function_privilege('service_role', 'public.claim_trusted_ingress_request(text, integer)', 'EXECUTE') then
    raise exception 'service_role cannot execute claim_trusted_ingress_request';
  end if;
  if has_table_privilege('service_role', 'private.trusted_ingress_replay_claims', 'SELECT')
     or has_table_privilege('authenticated', 'private.trusted_ingress_replay_claims', 'SELECT') then
    raise exception 'replay claim table is directly readable';
  end if;
end
$$;

set local role service_role;
do $$
declare
  claim_key constant text := encode(sha256('itx-replay-store-fixture'::bytea), 'hex');
  rejected boolean;
begin
  if public.claim_trusted_ingress_request(claim_key, 60) is distinct from true then
    raise exception 'first claim of an envelope was not granted';
  end if;
  -- Same envelope from another isolate: must be refused while unexpired.
  if public.claim_trusted_ingress_request(claim_key, 60) is distinct from false then
    raise exception 'replayed envelope was claimed twice';
  end if;

  rejected := false;
  begin
    perform public.claim_trusted_ingress_request('not-a-sha256-hex-digest', 60);
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then raise exception 'malformed claim key was accepted'; end if;

  rejected := false;
  begin
    perform public.claim_trusted_ingress_request(claim_key, 3600);
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then raise exception 'oversized claim TTL was accepted'; end if;
end
$$;

-- An expired claim is reusable (the signature window has passed).
reset role;
update private.trusted_ingress_replay_claims
set expires_at = now() - interval '1 second'
where claim_key = encode(sha256('itx-replay-store-fixture'::bytea), 'hex');

set local role service_role;
do $$
begin
  if public.claim_trusted_ingress_request(
    encode(sha256('itx-replay-store-fixture'::bytea), 'hex'), 60
  ) is distinct from true then
    raise exception 'expired claim could not be reclaimed';
  end if;
end
$$;

reset role;
do $$
begin
  if (select count(*) from private.trusted_ingress_replay_claims
      where claim_key = encode(sha256('itx-replay-store-fixture'::bytea), 'hex')) <> 1 then
    raise exception 'replay claims are not unique per envelope';
  end if;
end
$$;

rollback;
