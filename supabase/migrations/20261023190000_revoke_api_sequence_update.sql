-- API roles should not be able to change sequence state outside table policies.
-- Supabase's local API defaults can leave UPDATE on sequences even when
-- automatic table exposure is disabled.
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE UPDATE ON SEQUENCES FROM anon, authenticated;
