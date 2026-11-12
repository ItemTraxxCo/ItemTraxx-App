-- ITX-42: make "service-role only" intent explicit (advisor 0008_rls_enabled_no_policy).
--
-- The tables in the loop are accessed exclusively by edge functions using the
-- service_role key (service_role bypasses RLS). These explicit deny-all
-- policies document the intended boundary and clear the advisor lint.
--
-- cookie_consent_records is intentionally excluded: its accountless v2 INSERT
-- policy and matching database rate limit are managed by the versioned consent
-- migration and must not be replaced by a generic deny-all policy.
--
--   cookie_consent_records       -> consent-record; managed by its migration
--   email_delivery_logs          -> login-notify, _shared/emailDeliveryLog
--   legal_acceptances            -> written server-side only
--   privileged_session_stepups   -> _shared/privilegedStepUp
--   super_admin_email_challenges -> super-auth-verify

do $$
declare
  t text;
begin
  foreach t in array array[
    'email_delivery_logs',
    'legal_acceptances',
    'privileged_session_stepups',
    'super_admin_email_challenges'
  ]
  loop
    -- CodeRabbit: enforce RLS in the same migration so the deny policies
    -- actually protect the table regardless of external state.
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_service_role_only', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated, anon using (false) with check (false)',
      t || '_service_role_only', t
    );
  end loop;
end $$;
