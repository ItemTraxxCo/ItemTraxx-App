begin;

-- Accountless visitors may submit a v2 consent record directly with the anon
-- role. Keep every other client operation denied and keep row identity,
-- server timestamps, profile identity, and workspace identity out of the
-- client's writable set.
alter table public.cookie_consent_records enable row level security;
alter table public.cookie_consent_records force row level security;

revoke all on table public.cookie_consent_records
  from public, anon, authenticated;
revoke insert (
  subject_id,
  profile_id,
  consent_version,
  analytics,
  diagnostics,
  consented_at,
  recorded_at,
  created_at,
  workspace_id
) on table public.cookie_consent_records
  from public, anon, authenticated;

grant select, insert, update on table public.cookie_consent_records
  to service_role;
grant insert (
  consent_version,
  analytics,
  diagnostics,
  consented_at
) on table public.cookie_consent_records to anon;

drop policy if exists cookie_consent_records_service_role_only
  on public.cookie_consent_records;
drop policy if exists cookie_consent_records_anon_insert
  on public.cookie_consent_records;
drop policy if exists cookie_consent_records_anon_insert_bound
  on public.cookie_consent_records;
drop policy if exists cookie_consent_records_client_select_denied
  on public.cookie_consent_records;
drop policy if exists cookie_consent_records_client_update_denied
  on public.cookie_consent_records;
drop policy if exists cookie_consent_records_client_delete_denied
  on public.cookie_consent_records;

create policy cookie_consent_records_anon_insert
  on public.cookie_consent_records
  as permissive
  for insert to anon
  with check (
    profile_id is null
    and workspace_id is null
    and consent_version = 2
  );

-- A separate restrictive guard prevents a future permissive policy from
-- widening anonymous inserts beyond unlinked consent-v2 rows.
create policy cookie_consent_records_anon_insert_bound
  on public.cookie_consent_records
  as restrictive
  for insert to anon
  with check (
    profile_id is null
    and workspace_id is null
    and consent_version = 2
  );

create policy cookie_consent_records_client_select_denied
  on public.cookie_consent_records
  as restrictive
  for select to anon, authenticated
  using (false);

create policy cookie_consent_records_client_update_denied
  on public.cookie_consent_records
  as restrictive
  for update to anon, authenticated
  using (false)
  with check (false);

create policy cookie_consent_records_client_delete_denied
  on public.cookie_consent_records
  as restrictive
  for delete to anon, authenticated
  using (false);

-- Match the public consent-record Edge Function's 30-per-minute bucket for
-- direct Data API writes. Supabase sets cf-connecting-ip on API requests; use
-- the same normalized key/scope so direct inserts cannot bypass that limit.
create or replace function private.enforce_cookie_consent_direct_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text := current_setting('role', true);
  request_headers jsonb := coalesce(
    nullif(current_setting('request.headers', true), ''),
    '{}'
  )::jsonb;
  client_ip text;
  normalized_ip text;
  rate_key text;
  rate_scope text;
  rate_allowed boolean;
  retry_after_seconds integer;
begin
  if request_role is distinct from 'anon' then
    return new;
  end if;

  client_ip := nullif(btrim(request_headers ->> 'cf-connecting-ip'), '');
  if client_ip is null then
    rate_key := 'unknown-client';
  else
    normalized_ip := lower(client_ip);
    normalized_ip := regexp_replace(normalized_ip, '[^a-z0-9_-]', '-', 'g');
    normalized_ip := regexp_replace(normalized_ip, '-+', '-', 'g');
    normalized_ip := regexp_replace(normalized_ip, '(^-+)|(-+$)', '', 'g');
    rate_key := case
      when normalized_ip = '' then 'unknown-client'
      else 'ip-' || left(normalized_ip, 24)
    end;
  end if;

  rate_scope := 'consent-record-' || rate_key;
  select result.allowed, result.retry_after_seconds
    into rate_allowed, retry_after_seconds
  from public.consume_rate_limit_prelogin(rate_key, rate_scope, 30, 60) as result;

  if not found then
    raise exception 'Anonymous consent rate limit check failed'
      using errcode = 'P0001';
  end if;
  if rate_allowed is not true then
    raise exception using
      errcode = 'P0001',
      message = 'ANONYMOUS_CONSENT_RATE_LIMIT',
      detail = coalesce(retry_after_seconds, 60)::text;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_cookie_consent_direct_rate_limit()
  from public, anon, authenticated;

drop trigger if exists cookie_consent_anon_rate_limit
  on public.cookie_consent_records;
create trigger cookie_consent_anon_rate_limit
  before insert on public.cookie_consent_records
  for each row
  execute function private.enforce_cookie_consent_direct_rate_limit();

commit;
