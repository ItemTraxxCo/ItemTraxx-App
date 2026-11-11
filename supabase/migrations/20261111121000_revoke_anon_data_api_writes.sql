-- Least privilege for the public Data API roles.
--
-- `anon` still held Supabase's default INSERT/UPDATE/DELETE/TRUNCATE grants on
-- these tables. No RLS policy reaches anon/PUBLIC on any of them, so the writes
-- were already denied, but RLS was the only layer. 20260726120000 revoked the
-- same writes from `authenticated`; this closes the anon side.
--
-- TRUNCATE is not subject to RLS. PostgREST never issues it and Edge Functions
-- write through service_role, so neither browser role needs it.
revoke insert, update, delete, truncate on table
  public.account_sessions,
  public.borrower_access_grants,
  public.borrowers,
  public.customer_status_logs,
  public.item_access_grants,
  public.item_logs,
  public.item_status_history,
  public.items,
  public.profiles,
  public.sales_leads,
  public.workspace_policies,
  public.workspace_security_controls,
  public.workspaces
from anon;

revoke truncate on table
  public.account_sessions,
  public.admin_audit_logs,
  public.borrower_access_grants,
  public.borrowers,
  public.customer_status_logs,
  public.item_access_grants,
  public.item_logs,
  public.item_status_history,
  public.items,
  public.profiles,
  public.sales_leads,
  public.workspace_policies,
  public.workspace_security_controls,
  public.workspace_usage,
  public.workspaces
from anon, authenticated;

-- Stop tables created by future migrations from inheriting the same defaults.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon;
alter default privileges for role postgres in schema public
  revoke truncate on tables from authenticated;
