#!/usr/bin/env bash
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"

if [[ -z "$DB_URL" ]]; then
  echo "Missing SUPABASE_DB_URL or DATABASE_URL." >&2
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
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
SQL
