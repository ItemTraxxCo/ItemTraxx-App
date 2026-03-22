# Security Audit - Remediation Checklist

**Audit Date:** 2026-03-22
**PR Branch:** `claude/security-audit-code-app`

Copy this checklist to track security fixes. Check items off as you complete them.

---

## 🚨 CRITICAL (Must fix IMMEDIATELY)

- [ ] **E2E Test Utils Production Guard** (src/main.ts:31-103)
  - [ ] Add build-time validation in vite.config.ts
  - [ ] Verify `VITE_E2E_TEST_UTILS` not in production .env
  - [ ] Add runtime check for NODE_ENV !== 'production'
  - [ ] Test build fails with E2E utils enabled
  - [ ] Document in deployment checklist

**Assignee:** _______________
**Due Date:** _______________
**Status:** ⬜ Not Started / 🔄 In Progress / ✅ Complete

---

## 🔴 HIGH PRIORITY (Fix within 1 week)

### 1. Aikido Scanner Bypass
- [ ] Review bypass necessity with security team
- [ ] Decision: ⬜ Remove entirely OR ⬜ Restrict to staging
- [ ] If keeping: Add audit logging when bypass used
- [ ] If keeping: Implement time-based restrictions
- [ ] Update environment variable documentation

**File:** supabase/functions/tenant-login/index.ts:135-147
**Assignee:** _______________
**Due Date:** _______________

---

### 2. Session Validation Bypass Fix
- [ ] Update findActiveSession() to fail on missing table
- [ ] Return 503 Service Unavailable if relationMissing
- [ ] Add health check endpoint to verify table exists
- [ ] Update deployment checklist to verify RLS
- [ ] Add monitoring alert for 503 responses

**File:** supabase/functions/admin-ops/index.ts:354-358
**Assignee:** _______________
**Due Date:** _______________

---

### 3. District Handoff Token Refactor
- [ ] Design new handoff flow (POST-based)
- [ ] Implement short-lived one-time codes
- [ ] Add server-side token exchange endpoint
- [ ] Update frontend to use new flow
- [ ] Clear hash from URL after extraction
- [ ] Test with multiple districts
- [ ] Update documentation

**File:** src/services/authService.ts:537-645
**Assignee:** _______________
**Due Date:** _______________

---

### 4. CSP Headers for Edge Functions
- [ ] Create shared CSP header constant
- [ ] Add CSP to all edge function responses
- [ ] Include: X-Content-Type-Options: nosniff
- [ ] Include: X-Frame-Options: DENY
- [ ] Test with security scanner
- [ ] Verify no legitimate requests blocked

**Files:** All supabase/functions/**/index.ts
**Assignee:** _______________
**Due Date:** _______________

---

### 5. Contact Form Rate Limiting Enhancement
- [ ] Reduce limit from 5/hour to 3/hour
- [ ] Implement exponential backoff
- [ ] Add email domain reputation check
- [ ] Add monitoring for abuse patterns
- [ ] Test rate limit enforcement
- [ ] Update user-facing error messages

**Files:**
- supabase/functions/contact-sales-submit/index.ts
- supabase/functions/contact-support-submit/index.ts

**Assignee:** _______________
**Due Date:** _______________

---

## 🟡 MEDIUM PRIORITY (Fix within 2-3 weeks)

### 6. Client-Side Sanitizer Documentation
- [ ] Add comment: "For UX only - not security"
- [ ] Document server-side validation as actual security
- [ ] Add examples of proper validation
- [ ] Remove misleading security claims

**File:** src/utils/inputSanitizer.ts
**Assignee:** _______________
**Due Date:** _______________

---

### 7. User-Agent and Device Label Escaping
- [ ] Add HTML escaping function to shared utils
- [ ] Escape user-agent before storage
- [ ] Escape device labels before storage
- [ ] Audit all display locations
- [ ] Consider storing hash instead of full UA

**File:** supabase/functions/admin-ops/index.ts:148
**Assignee:** _______________
**Due Date:** _______________

---

### 8. Generic Authentication Error Messages
- [ ] Replace "Access denied" with "Invalid credentials"
- [ ] Update super-auth-verify error messages
- [ ] Update tenant-login error messages
- [ ] Ensure constant-time password comparison
- [ ] Add rate limiting per failed attempt

**Files:**
- supabase/functions/super-auth-verify/index.ts:301-315
- supabase/functions/tenant-login/index.ts

**Assignee:** _______________
**Due Date:** _______________

---

### 9. Maintenance Mode Message Escaping
- [ ] Add HTML escaping for runtime config values
- [ ] Update resolveMaintenance() function
- [ ] Use textContent instead of innerHTML
- [ ] Test with various message formats
- [ ] Document escaping requirement

**File:** supabase/functions/admin-ops/index.ts:372
**Assignee:** _______________
**Due Date:** _______________

---

## ✅ VERIFICATION & TESTING

### Security Testing Checklist
- [ ] Run `npm audit` and fix high-severity issues
- [ ] Test with securityheaders.com
- [ ] Run OWASP ZAP automated scan
- [ ] Perform manual penetration testing
- [ ] Test authentication bypass scenarios
- [ ] Test rate limiting enforcement
- [ ] Verify CSP doesn't block legitimate requests
- [ ] Test session revocation

**Assignee:** _______________
**Due Date:** _______________

---

### Documentation Updates
- [ ] Update SECURITY.md with new controls
- [ ] Add security testing to CI/CD pipeline
- [ ] Create security runbook for ops team
- [ ] Document incident response procedures
- [ ] Update deployment checklist

**Assignee:** _______________
**Due Date:** _______________

---

## 📊 TRACKING

### Overall Progress
- Critical Issues: 0 / 1 complete (0%)
- High Priority: 0 / 5 complete (0%)
- Medium Priority: 0 / 4 complete (0%)
- **Total: 0 / 10 complete (0%)**

### Review Dates
- Initial Review: _______________
- Mid-Point Check: _______________
- Final Review: _______________
- Security Re-Audit: _______________

---

## 📝 NOTES

Use this section to track decisions, blockers, or important context:

```
[Date] [Name]: Note here
```

---

## 🔗 REFERENCES

- Full Report: `SECURITY_AUDIT_REPORT.md`
- Quick Reference: `SECURITY_AUDIT_SUMMARY.md`
- Security Policy: `SECURITY.md`
- RLS Policies: `supabase/sql/rbac_hardening.sql`

---

## ✅ COMPLETION SIGN-OFF

When all items are complete:

- [ ] All critical issues resolved
- [ ] All high priority issues resolved
- [ ] All medium priority issues resolved
- [ ] Security testing passed
- [ ] Documentation updated
- [ ] Code reviewed by security lead
- [ ] Deployed to staging and tested
- [ ] Ready for production deployment

**Completed By:** _______________
**Date:** _______________
**Approved By:** _______________
**Date:** _______________
