# Release Checklist

## Pre-Merge
- [ ] PR approved.
- [ ] CI Core passing.
- [ ] E2E passing.
- [ ] Security audit passing.
- [ ] Changelog updated.

## Pre-Deploy
- [ ] Required environment variables present.
- [ ] Edge function changes reviewed for auth mode.
- [ ] Database migrations reviewed and reversible.
- [ ] Rollback plan prepared.

## Deploy
- [ ] Deploy frontend.
- [ ] Deploy updated edge functions.
- [ ] Verify no secret/config drift.

## Post-Deploy Smoke Tests
- [ ] Tenant login.
- [ ] Tenant admin login.
- [ ] Checkout and return submission.
- [ ] Student add/edit flow.
- [ ] System status and notifications.

## Post-Deploy Monitoring (30-60 min)
- [ ] Error rate stable.
- [ ] No auth 401 spike.
- [ ] No critical support tickets.

## Rollback Triggers
- [ ] Core route unavailable.
- [ ] Auth failure rate materially elevated.
- [ ] Data integrity risk detected.
