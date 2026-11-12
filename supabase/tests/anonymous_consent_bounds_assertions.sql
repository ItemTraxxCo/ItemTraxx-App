\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  utc_day date := (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date;
  expired_subject uuid := gen_random_uuid();
  capped_subject uuid := gen_random_uuid();
  rejected_subject uuid := gen_random_uuid();
  test_profile_id uuid := gen_random_uuid();
  authenticated_subject uuid := gen_random_uuid();
  capped_created_at timestamptz;
  caught_message text;
BEGIN
  IF NOT (
    SELECT relrowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.cookie_consent_records'::regclass
  ) THEN
    RAISE EXCEPTION 'cookie consent records must have row-level security enabled';
  END IF;

  IF to_regclass('public.cookie_consent_profile_version_uidx') IS NOT NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_index
       WHERE indexrelid = to_regclass('public.cookie_consent_profile_version_idx')
         AND indisunique IS FALSE
     ) THEN
    RAISE EXCEPTION 'profile consent history must remain non-unique';
  END IF;

  IF has_table_privilege('anon', 'public.cookie_consent_records', 'SELECT')
     OR has_table_privilege('anon', 'public.cookie_consent_records', 'INSERT')
     OR has_table_privilege('anon', 'public.cookie_consent_records', 'UPDATE')
     OR has_table_privilege('anon', 'public.cookie_consent_records', 'DELETE')
     OR has_table_privilege('authenticated', 'public.cookie_consent_records', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cookie_consent_records', 'INSERT') THEN
    RAISE EXCEPTION 'client roles must not read or mutate cookie consent records broadly';
  END IF;

  IF has_column_privilege('anon', 'public.cookie_consent_records', 'subject_id', 'INSERT')
     OR NOT has_column_privilege('anon', 'public.cookie_consent_records', 'consent_version', 'INSERT')
     OR NOT has_column_privilege('anon', 'public.cookie_consent_records', 'analytics', 'INSERT')
     OR NOT has_column_privilege('anon', 'public.cookie_consent_records', 'diagnostics', 'INSERT')
     OR NOT has_column_privilege('anon', 'public.cookie_consent_records', 'consented_at', 'INSERT')
     OR has_column_privilege('anon', 'public.cookie_consent_records', 'profile_id', 'INSERT')
     OR has_column_privilege('anon', 'public.cookie_consent_records', 'recorded_at', 'INSERT')
     OR has_column_privilege('anon', 'public.cookie_consent_records', 'created_at', 'INSERT')
     OR has_column_privilege('anon', 'public.cookie_consent_records', 'workspace_id', 'INSERT') THEN
    RAISE EXCEPTION 'anonymous consent inserts must use a server-generated identity and only client-owned consent fields';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cookie_consent_records'
      AND policyname = 'cookie_consent_records_anon_insert'
      AND cmd = 'INSERT'
      AND 'anon' = ANY(roles)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cookie_consent_records'
      AND policyname = 'cookie_consent_records_anon_insert_bound'
      AND cmd = 'INSERT'
      AND permissive = 'RESTRICTIVE'
  ) THEN
    RAISE EXCEPTION 'anonymous consent insert policy or restrictive row bound is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    JOIN pg_proc AS trigger_function
      ON trigger_function.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'public.cookie_consent_records'::regclass
      AND trigger_row.tgname = 'cookie_consent_anon_rate_limit'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled IN ('O', 'A')
      AND (trigger_row.tgtype & 1) = 1
      AND (trigger_row.tgtype & 2) = 2
      AND (trigger_row.tgtype & 4) = 4
      AND trigger_function.prosecdef
      AND position('cf-connecting-ip' in pg_get_functiondef(trigger_function.oid)) > 0
      AND position('rate_scope := ''consent-record-'' || rate_key' in pg_get_functiondef(trigger_function.oid)) > 0
      AND position('rate_key, rate_scope, 30, 60' in pg_get_functiondef(trigger_function.oid)) > 0
  ) OR to_regprocedure('private.enforce_cookie_consent_direct_rate_limit()') IS NULL
    OR has_function_privilege(
      'anon',
      'public.consume_rate_limit_prelogin(text,text,integer,integer)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'direct anonymous consent inserts must use the guarded database limiter';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.purge_expired_anonymous_cookie_consent_records()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.purge_expired_anonymous_cookie_consent_records()',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.purge_expired_anonymous_cookie_consent_records()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'anonymous consent retention must be service-role-only';
  END IF;

  IF position(
       '730 days'
       IN pg_catalog.pg_get_functiondef(
         'public.purge_expired_anonymous_cookie_consent_records()'::regprocedure
       )
     ) = 0
     OR position(
       'created_at'
       IN pg_catalog.pg_get_functiondef(
         'public.purge_expired_anonymous_cookie_consent_records()'::regprocedure
       )
     ) = 0
     OR position(
       '5000'
       IN pg_catalog.pg_get_functiondef(
         'public.enforce_anonymous_cookie_consent_daily_limit()'::regprocedure
       )
     ) = 0 THEN
    RAISE EXCEPTION 'retention window or global daily cap is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'itemtraxx-anonymous-cookie-consent-retention'
  ) THEN
    RAISE EXCEPTION 'daily anonymous consent retention job is missing';
  END IF;

  UPDATE public.cookie_consent_write_budget
  SET budget_day = utc_day,
      anonymous_rows_created = 0,
      last_retention_day = utc_day - 1
  WHERE singleton_id = 1;

  INSERT INTO public.cookie_consent_records (
    subject_id,
    profile_id,
    consent_version,
    analytics,
    diagnostics,
    consented_at,
    recorded_at,
    created_at
  ) VALUES (
    expired_subject,
    NULL,
    2,
    FALSE,
    FALSE,
    pg_catalog.clock_timestamp() - INTERVAL '731 days',
    pg_catalog.clock_timestamp() - INTERVAL '731 days',
    pg_catalog.clock_timestamp() - INTERVAL '731 days'
  );

  UPDATE public.cookie_consent_write_budget
  SET budget_day = utc_day,
      anonymous_rows_created = 4999,
      last_retention_day = utc_day
  WHERE singleton_id = 1;

  INSERT INTO public.cookie_consent_records (
    subject_id,
    profile_id,
    consent_version,
    analytics,
    diagnostics,
    consented_at
  ) VALUES (
    capped_subject,
    NULL,
    2,
    FALSE,
    FALSE,
    pg_catalog.clock_timestamp()
  );
  SELECT created_at
  INTO capped_created_at
  FROM public.cookie_consent_records
  WHERE subject_id = capped_subject
    AND consent_version = 2;

  BEGIN
    INSERT INTO public.cookie_consent_records (
      subject_id,
      profile_id,
      consent_version,
      analytics,
      diagnostics,
      consented_at
    ) VALUES (
      rejected_subject,
      NULL,
      2,
      FALSE,
      FALSE,
      pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'a new anonymous subject was accepted over the daily cap';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS caught_message = MESSAGE_TEXT;
    IF caught_message <> 'ANONYMOUS_CONSENT_DAILY_LIMIT' THEN
      RAISE EXCEPTION 'unexpected P0001 error at cap: %', caught_message;
    END IF;
  END;

  INSERT INTO public.cookie_consent_records (
    subject_id,
    profile_id,
    consent_version,
    analytics,
    diagnostics,
    consented_at
  ) VALUES (
    capped_subject,
    NULL,
    2,
    TRUE,
    FALSE,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT (subject_id, consent_version)
  DO UPDATE SET analytics = EXCLUDED.analytics;

  IF (SELECT anonymous_rows_created
      FROM public.cookie_consent_write_budget
      WHERE singleton_id = 1) <> 5000 THEN
    RAISE EXCEPTION 'an existing-subject update changed the daily new-row count';
  END IF;

  IF (SELECT created_at
      FROM public.cookie_consent_records
      WHERE subject_id = capped_subject
        AND consent_version = 2) IS DISTINCT FROM capped_created_at THEN
    RAISE EXCEPTION 'an existing-subject update changed the immutable creation time';
  END IF;

  INSERT INTO auth.users (id, email)
  VALUES (test_profile_id, test_profile_id::text || '@consent-limit.test');
  INSERT INTO public.profiles (id, role, auth_email)
  VALUES (
    test_profile_id,
    'tenant_account',
    test_profile_id::text || '@consent-limit.test'
  );
  INSERT INTO public.cookie_consent_records (
    subject_id,
    profile_id,
    consent_version,
    analytics,
    diagnostics,
    consented_at
  ) VALUES (
    authenticated_subject,
    test_profile_id,
    2,
    FALSE,
    FALSE,
    pg_catalog.clock_timestamp()
  );

  BEGIN
    INSERT INTO public.cookie_consent_records (
      subject_id,
      profile_id,
      consent_version,
      analytics,
      diagnostics,
      consented_at
    ) VALUES (
      authenticated_subject,
      NULL,
      2,
      TRUE,
      FALSE,
      pg_catalog.clock_timestamp()
    )
    ON CONFLICT (subject_id, consent_version)
    DO UPDATE SET profile_id = EXCLUDED.profile_id;
    RAISE EXCEPTION 'an authenticated subject became anonymous without using the daily cap';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS caught_message = MESSAGE_TEXT;
    IF caught_message <> 'ANONYMOUS_CONSENT_DAILY_LIMIT' THEN
      RAISE EXCEPTION 'unexpected P0001 error while anonymizing a subject: %', caught_message;
    END IF;
  END;

  IF (SELECT profile_id
      FROM public.cookie_consent_records
      WHERE subject_id = authenticated_subject
        AND consent_version = 2) IS DISTINCT FROM test_profile_id THEN
    RAISE EXCEPTION 'a capped anonymous transition changed the authenticated consent row';
  END IF;

  BEGIN
    INSERT INTO public.cookie_consent_records (
      subject_id,
      profile_id,
      consent_version,
      analytics,
      diagnostics,
      consented_at
    ) VALUES (
      expired_subject,
      NULL,
      2,
      TRUE,
      FALSE,
      pg_catalog.clock_timestamp()
    )
    ON CONFLICT (subject_id, consent_version)
    DO UPDATE SET analytics = EXCLUDED.analytics;
    RAISE EXCEPTION 'an expired subject was refreshed without using the daily cap';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS caught_message = MESSAGE_TEXT;
    IF caught_message <> 'ANONYMOUS_CONSENT_DAILY_LIMIT' THEN
      RAISE EXCEPTION 'unexpected P0001 error while refreshing an expired subject: %', caught_message;
    END IF;
  END;

  UPDATE public.cookie_consent_write_budget
  SET last_retention_day = utc_day - 1
  WHERE singleton_id = 1;
  PERFORM public.purge_expired_anonymous_cookie_consent_records();

  IF EXISTS (
    SELECT 1
    FROM public.cookie_consent_records
    WHERE subject_id = expired_subject
      AND consent_version = 2
  ) THEN
    RAISE EXCEPTION 'anonymous consent older than 730 days was retained';
  END IF;
END;
$$;

-- Exercise the real anonymous column grants, RLS policies, defaults, and
-- database rate-limit trigger. The surrounding transaction rolls this row back.
UPDATE public.cookie_consent_write_budget
SET budget_day = (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date,
    anonymous_rows_created = 0,
    last_retention_day = (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date
WHERE singleton_id = 1;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config(
  'request.headers',
  '{"cf-connecting-ip":"192.0.2.123"}',
  true
);
INSERT INTO public.cookie_consent_records (
  consent_version,
  analytics,
  diagnostics,
  consented_at
) VALUES (
  2,
  TRUE,
  TRUE,
  timestamptz '1901-01-01 00:00:00+00'
);
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.cookie_consent_records
    WHERE consent_version = 2
      AND profile_id IS NULL
      AND workspace_id IS NULL
      AND analytics IS TRUE
      AND diagnostics IS TRUE
      AND consented_at = timestamptz '1901-01-01 00:00:00+00'
      AND subject_id IS NOT NULL
      AND recorded_at > now() - interval '2 minutes'
      AND created_at > now() - interval '2 minutes'
  ) THEN
    RAISE EXCEPTION 'anonymous v2 insert did not create an unlinked row with server defaults';
  END IF;

  IF (SELECT anonymous_rows_created
      FROM public.cookie_consent_write_budget
      WHERE singleton_id = 1) <> 1 THEN
    RAISE EXCEPTION 'anonymous v2 insert did not consume exactly one daily budget entry';
  END IF;
END;
$$;

ROLLBACK;
