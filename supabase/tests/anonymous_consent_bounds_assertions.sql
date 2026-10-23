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

  IF has_table_privilege('anon', 'public.cookie_consent_records', 'SELECT')
     OR has_table_privilege('anon', 'public.cookie_consent_records', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cookie_consent_records', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cookie_consent_records', 'INSERT') THEN
    RAISE EXCEPTION 'client roles must not access cookie consent records directly';
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

ROLLBACK;
