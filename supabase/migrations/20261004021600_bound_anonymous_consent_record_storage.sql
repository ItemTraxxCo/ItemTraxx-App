-- Bound anonymous consent mirror writes and expire anonymous records after the
-- repository's existing 730-day audit-retention window.

CREATE TABLE IF NOT EXISTS public.cookie_consent_records (
  subject_id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  consent_version integer NOT NULL CHECK (consent_version > 0),
  analytics boolean NOT NULL,
  diagnostics boolean NOT NULL,
  consented_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid NULL REFERENCES public.workspaces(id) ON DELETE SET NULL,
  PRIMARY KEY (subject_id, consent_version)
);

ALTER TABLE public.cookie_consent_records
  ADD COLUMN IF NOT EXISTS workspace_id uuid NULL
  REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE public.cookie_consent_records
  ADD COLUMN IF NOT EXISTS created_at timestamptz;
UPDATE public.cookie_consent_records
SET created_at = recorded_at
WHERE created_at IS NULL;
ALTER TABLE public.cookie_consent_records
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.cookie_consent_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cookie_consent_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cookie_consent_records TO service_role;

CREATE INDEX IF NOT EXISTS cookie_consent_records_anonymous_retention_idx
  ON public.cookie_consent_records (created_at)
  WHERE profile_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cookie_consent_profile_version_uidx
  ON public.cookie_consent_records (profile_id, consent_version)
  WHERE profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cookie_consent_write_budget (
  singleton_id smallint PRIMARY KEY CHECK (singleton_id = 1),
  budget_day date NOT NULL,
  anonymous_rows_created integer NOT NULL DEFAULT 0
    CHECK (anonymous_rows_created BETWEEN 0 AND 5000),
  last_retention_day date NULL
);

ALTER TABLE public.cookie_consent_write_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cookie_consent_write_budget
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.cookie_consent_write_budget (
  singleton_id,
  budget_day,
  anonymous_rows_created,
  last_retention_day
)
SELECT
  1,
  (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date,
  LEAST(
    5000,
    COALESCE((
      SELECT count(*)::integer
      FROM public.cookie_consent_records AS consent
      WHERE consent.profile_id IS NULL
        AND consent.created_at >= (
          (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date::timestamp
          AT TIME ZONE 'UTC'
        )
    ), 0)
  ),
  NULL
ON CONFLICT (singleton_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.purge_expired_anonymous_cookie_consent_records()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  now_ts timestamptz;
  utc_day date;
  budget_day date;
  last_retention_day date;
  deleted_rows integer := 0;
BEGIN
  INSERT INTO public.cookie_consent_write_budget (
    singleton_id,
    budget_day,
    anonymous_rows_created,
    last_retention_day
  )
  VALUES (
    1,
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date,
    0,
    NULL
  )
  ON CONFLICT (singleton_id) DO NOTHING;

  SELECT state.budget_day, state.last_retention_day
  INTO budget_day, last_retention_day
  FROM public.cookie_consent_write_budget AS state
  WHERE state.singleton_id = 1
  FOR UPDATE;

  now_ts := pg_catalog.clock_timestamp();
  utc_day := (now_ts AT TIME ZONE 'UTC')::date;

  IF budget_day IS DISTINCT FROM utc_day THEN
    UPDATE public.cookie_consent_write_budget
    SET budget_day = utc_day,
        anonymous_rows_created = 0
    WHERE singleton_id = 1;
  END IF;

  IF last_retention_day IS DISTINCT FROM utc_day THEN
    DELETE FROM public.cookie_consent_records AS consent
    WHERE consent.profile_id IS NULL
      AND consent.created_at < now_ts - INTERVAL '730 days';
    GET DIAGNOSTICS deleted_rows = ROW_COUNT;

    UPDATE public.cookie_consent_write_budget
    SET last_retention_day = utc_day
    WHERE singleton_id = 1;
  END IF;

  RETURN deleted_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_anonymous_cookie_consent_records()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_anonymous_cookie_consent_records()
  TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_anonymous_cookie_consent_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  now_ts timestamptz;
  utc_day date;
  budget_day date;
  current_count integer;
  last_retention_day date;
BEGIN
  IF NEW.profile_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.purge_expired_anonymous_cookie_consent_records();

  SELECT
    state.budget_day,
    state.anonymous_rows_created,
    state.last_retention_day
  INTO budget_day, current_count, last_retention_day
  FROM public.cookie_consent_write_budget AS state
  WHERE state.singleton_id = 1
  FOR UPDATE;

  now_ts := pg_catalog.clock_timestamp();
  utc_day := (now_ts AT TIME ZONE 'UTC')::date;

  IF last_retention_day IS DISTINCT FROM utc_day THEN
    PERFORM public.purge_expired_anonymous_cookie_consent_records();
    SELECT
      state.budget_day,
      state.anonymous_rows_created,
      state.last_retention_day
    INTO budget_day, current_count, last_retention_day
    FROM public.cookie_consent_write_budget AS state
    WHERE state.singleton_id = 1
    FOR UPDATE;
    now_ts := pg_catalog.clock_timestamp();
    utc_day := (now_ts AT TIME ZONE 'UTC')::date;
  END IF;

  IF budget_day IS DISTINCT FROM utc_day THEN
    UPDATE public.cookie_consent_write_budget
    SET budget_day = utc_day,
        anonymous_rows_created = 0
    WHERE singleton_id = 1;
    current_count := 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cookie_consent_records AS consent
    WHERE consent.subject_id = NEW.subject_id
      AND consent.consent_version = NEW.consent_version
      AND consent.profile_id IS NULL
      AND consent.created_at >= now_ts - INTERVAL '730 days'
  ) THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.cookie_consent_records AS consent
  WHERE consent.subject_id = NEW.subject_id
    AND consent.consent_version = NEW.consent_version
    AND consent.profile_id IS NULL
    AND consent.created_at < now_ts - INTERVAL '730 days';

  IF current_count >= 5000 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ANONYMOUS_CONSENT_DAILY_LIMIT';
  END IF;

  UPDATE public.cookie_consent_write_budget
  SET anonymous_rows_created = anonymous_rows_created + 1
  WHERE singleton_id = 1;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_anonymous_cookie_consent_daily_limit()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS cookie_consent_anonymous_daily_limit
  ON public.cookie_consent_records;
CREATE TRIGGER cookie_consent_anonymous_daily_limit
  BEFORE INSERT ON public.cookie_consent_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_anonymous_cookie_consent_daily_limit();

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'itemtraxx-anonymous-cookie-consent-retention',
  '30 3 * * *',
  'select public.purge_expired_anonymous_cookie_consent_records();'
);
