# Async Jobs and Reporting Refresh

## Overview

ItemTraxx now includes an async background job pipeline for non-blocking tasks:

- `contact_sales_email`: queued by `contact-sales-submit`, processed by `job-worker`
- `refresh_reporting_views`: supported by `job-worker` (manual or scheduled invocation)

## Components

- DB queue table + RPCs: `supabase/sql/async_jobs.sql`
- Reporting materialized view + refresh RPC: `supabase/sql/reporting_views.sql`
- Worker edge function: `supabase/functions/job-worker/index.ts`
- Worker scheduler: `.github/workflows/async-job-worker.yml`

## Required Secrets

### Supabase Edge Functions
- `ITX_JOB_WORKER_SECRET`

### GitHub Actions (`ItemTraxx-App`)
- `ITX_JOB_WORKER_SECRET`

## Deploy Checklist

1. Run SQL:
   - `supabase/sql/async_jobs.sql`
   - `supabase/sql/reporting_views.sql`
2. Deploy functions:
   - `contact-sales-submit`
   - `job-worker`
   - `super-dashboard`
3. Deploy Cloudflare worker allowlist update (`job-worker`).
4. Verify workflow `Async Job Worker` succeeds.

## Quick Verification

1. Submit a Contact Sales request.
2. Trigger `Async Job Worker` from Actions (`workflow_dispatch`).
3. Confirm:
   - email job transitions to `completed` in `async_jobs`
   - sales lead still records immediately
   - super dashboard displays tenant metrics populated from reporting materialized view
