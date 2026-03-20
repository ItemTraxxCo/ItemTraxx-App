# Maintenance Checklist

This checklist is for routine ItemTraxx operational maintenance after production is live.

## Weekly
1. Review GitHub Actions runs for failed deploys or flaky jobs.
2. Review Supabase function logs for repeated errors, auth failures, and rate-limit spikes.
3. Review Cloudflare Worker errors and request analytics.
4. Review support volume and recurring incident patterns.
5. Check `email_delivery_logs` for failed sends or provider-side problems.

## Monthly
1. Review who has access to GitHub, Supabase, Cloudflare, and production email tooling.
2. Review super admin accounts and remove stale or unnecessary access.
3. Review table growth for:
   - `email_delivery_logs`
   - `async_jobs`
   - audit log tables
   - rate-limit tables
4. Confirm log retention and cleanup jobs are working as expected.
5. Verify the current deploy and rollback runbooks still match reality.

## Quarterly
1. Rotate sensitive deploy and service credentials.
2. Re-run a focused security review of auth, admin access, and edge functions.
3. Verify backup and restore procedures still work.
4. Review production RLS policies, grants, and storage access for drift.
5. Review Cloudflare, Supabase, and GitHub organization settings for unnecessary privileges.

## After Every Production Deploy
1. Test tenant login.
2. Test district handoff login.
3. Test super admin login.
4. Test password reset.
5. Test tenant creation.
6. Test checkout and return.
7. Confirm login notification and other critical transactional emails still send.

## After Major Auth or Infra Changes
1. Re-run security validation against privileged auth paths.
2. Re-check rate limiting and CAPTCHA enforcement server-side.
3. Re-check district handoff behavior.
4. Update any affected runbooks.
5. Record accepted risks and changed assumptions.

## Minimum Ownership Expectations
1. At least two people should receive production alerts.
2. At least two people should be able to perform an emergency deploy.
3. At least one break-glass manual deploy path should remain documented and tested.
