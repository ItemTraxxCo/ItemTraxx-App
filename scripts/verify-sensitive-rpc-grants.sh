#!/usr/bin/env bash
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"

if [[ -z "$DB_URL" ]]; then
  echo "Missing SUPABASE_DB_URL or DATABASE_URL." >&2
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
select
  'public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)' as function_name,
  has_function_privilege('anon', 'public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', 'public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', 'public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE') as service_role_execute
union all
select
  'public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)' as function_name,
  has_function_privilege('anon', 'public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', 'public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', 'public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE') as service_role_execute
union all
select
  'public.enqueue_async_job(text,jsonb,integer,timestamptz,integer)' as function_name,
  has_function_privilege('anon', 'public.enqueue_async_job(text,jsonb,integer,timestamptz,integer)', 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', 'public.enqueue_async_job(text,jsonb,integer,timestamptz,integer)', 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', 'public.enqueue_async_job(text,jsonb,integer,timestamptz,integer)', 'EXECUTE') as service_role_execute
union all
select
  'public.claim_async_jobs(uuid,integer)' as function_name,
  has_function_privilege('anon', 'public.claim_async_jobs(uuid,integer)', 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', 'public.claim_async_jobs(uuid,integer)', 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', 'public.claim_async_jobs(uuid,integer)', 'EXECUTE') as service_role_execute
union all
select
  'public.refresh_super_reporting_views()' as function_name,
  has_function_privilege('anon', 'public.refresh_super_reporting_views()', 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', 'public.refresh_super_reporting_views()', 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', 'public.refresh_super_reporting_views()', 'EXECUTE') as service_role_execute
union all
select
  'public.run_data_retention()' as function_name,
  has_function_privilege('anon', 'public.run_data_retention()', 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', 'public.run_data_retention()', 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', 'public.run_data_retention()', 'EXECUTE') as service_role_execute
union all
select
  'public.current_session_binding_key()' as function_name,
  has_function_privilege('anon', 'public.current_session_binding_key()', 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', 'public.current_session_binding_key()', 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', 'public.current_session_binding_key()', 'EXECUTE') as service_role_execute
union all
select
  'public.has_recent_privileged_step_up(text)' as function_name,
  has_function_privilege('anon', 'public.has_recent_privileged_step_up(text)', 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', 'public.has_recent_privileged_step_up(text)', 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', 'public.has_recent_privileged_step_up(text)', 'EXECUTE') as service_role_execute;

do $$
declare
  function_signature text;
  unexpected_function text;
begin
  if to_regprocedure('public.consume_rate_limit(text,integer,integer)') is null then
    raise exception 'Missing RPC definition for public.consume_rate_limit(text,integer,integer)';
  end if;

  if to_regprocedure('public.consume_rate_limit_prelogin(text,text,integer,integer)') is null then
    raise exception 'Missing RPC definition for public.consume_rate_limit_prelogin(text,text,integer,integer)';
  end if;

  if has_function_privilege('anon', 'public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE') then
    raise exception 'Unsafe RPC grants for public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)';
  end if;

  if not has_function_privilege('anon', 'public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)', 'EXECUTE') then
    raise exception 'Unsafe RPC grants for public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)';
  end if;

  foreach function_signature in array array[
    'public.enqueue_async_job(text,jsonb,integer,timestamptz,integer)',
    'public.claim_async_jobs(uuid,integer)',
    'public.refresh_super_reporting_views()',
    'public.run_data_retention()'
  ]
  loop
    if has_function_privilege('anon', function_signature, 'EXECUTE')
      or has_function_privilege('authenticated', function_signature, 'EXECUTE')
      or not has_function_privilege('service_role', function_signature, 'EXECUTE') then
      raise exception 'Unsafe RPC grants for %', function_signature;
    end if;
  end loop;

  select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
  into unexpected_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) not in (
      'public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)',
      'public.current_district_id()',
      'public.current_tenant_id()',
      'public.current_user_role()',
      'public.resolve_public_district_by_id(input_id uuid)',
      'public.resolve_public_district_by_slug(input_slug text)'
    )
  limit 1;

  if unexpected_function is not null then
    raise exception 'Unexpected anon-executable SECURITY DEFINER function: %', unexpected_function;
  end if;

  select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
  into unexpected_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) not in (
      'public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)',
      'public.consume_rate_limit_prelogin(p_key text, p_scope text, p_limit integer, p_window_seconds integer)',
      'public.current_district_id()',
      'public.current_session_binding_key()',
      'public.current_tenant_id()',
      'public.current_user_role()',
      'public.has_recent_privileged_step_up(p_role_scope text)',
      'public.resolve_public_district_by_id(input_id uuid)',
      'public.resolve_public_district_by_slug(input_slug text)'
    )
  limit 1;

  if unexpected_function is not null then
    raise exception 'Unexpected authenticated-executable SECURITY DEFINER function: %', unexpected_function;
  end if;
end;
$$;
SQL
