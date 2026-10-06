-- Workspace members need only the due-hour and feature-flag settings. A
-- table-wide SELECT grant also exposed billing contacts and subscription
-- metadata through direct REST and relation-embedding queries.
revoke select on public.workspace_policies from authenticated;
grant select (workspace_id, checkout_due_hours, feature_flags)
  on public.workspace_policies to authenticated;
