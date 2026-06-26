-- ITX-42: make "service-role only" intent explicit (advisor 0008_rls_enabled_no_policy).
--
-- These tables are written/read exclusively by edge functions running with the
-- service_role key (service_role bypasses RLS). No client/anon/authenticated
-- access path exists. RLS is enabled with no policy, so non-service roles are
-- already denied — these explicit deny-all policies don't change effective
-- access, they document the intent and clear the advisor lint.
--
--   cookie_consent_records       -> consent-record
--   email_delivery_logs          -> login-notify, _shared/emailDeliveryLog
--   legal_acceptances            -> written server-side only
--   privileged_session_stepups   -> _shared/privilegedStepUp
--   super_admin_email_challenges -> super-auth-verify

do $$
declare
  t text;
begin
  foreach t in array array[
    'cookie_consent_records',
    'email_delivery_logs',
    'legal_acceptances',
    'privileged_session_stepups',
    'super_admin_email_challenges'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_service_role_only', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated, anon using (false) with check (false)',
      t || '_service_role_only', t
    );
  end loop;
end $$;
