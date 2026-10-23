\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF has_table_privilege('anon', 'private.turnstile_token_redemptions', 'SELECT')
     OR has_table_privilege('anon', 'private.turnstile_token_redemptions', 'INSERT')
     OR has_table_privilege('authenticated', 'private.turnstile_token_redemptions', 'SELECT')
     OR has_table_privilege('authenticated', 'private.turnstile_token_redemptions', 'INSERT')
     OR has_table_privilege('service_role', 'private.turnstile_token_redemptions', 'SELECT')
     OR has_table_privilege('service_role', 'private.turnstile_token_redemptions', 'INSERT') THEN
    RAISE EXCEPTION 'Turnstile token fingerprints must be inaccessible directly';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.consume_turnstile_token(text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.consume_turnstile_token(text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.consume_turnstile_token(text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Turnstile token consumption must be service-role-only';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'itemtraxx-turnstile-token-retention'
  ) THEN
    RAISE EXCEPTION 'Turnstile token fingerprint retention job is missing';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;

DO $$
DECLARE
  token_hash text := repeat('a', 64);
BEGIN
  IF public.consume_turnstile_token(token_hash) IS NOT TRUE THEN
    RAISE EXCEPTION 'first Turnstile token redemption should pass';
  END IF;

  IF public.consume_turnstile_token(token_hash) IS NOT FALSE THEN
    RAISE EXCEPTION 'duplicate Turnstile token redemption should fail';
  END IF;

  IF public.consume_turnstile_token('invalid-hash') IS NOT FALSE THEN
    RAISE EXCEPTION 'malformed Turnstile token fingerprint should fail';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
