# Deploy Supabase Functions

## Purpose
Deploys tracked Supabase Edge Functions from GitHub Actions using the repo-pinned Supabase CLI.

## Trigger
- Push to `main` when one of these paths changes:
  - `supabase/functions/**`
  - `supabase/config.toml`
  - `scripts/deploy-supabase-functions.py`
  - `.github/workflows/deploy-supabase-functions.yml`
- Manual: `workflow_dispatch`
  - Optional input: `functions` (space-separated names)

## Required Secrets
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- Slack secrets if notifications are desired

## Behavior
- Runs `npm ci`
- Executes `python3 ./scripts/deploy-supabase-functions.py --project-ref "$SUPABASE_PROJECT_REF"`
- If `functions` is provided, deploys only those functions
- Uses the repo-managed Supabase CLI from `node_modules/.bin/supabase`

## Failure Handling
Check the `Deploy functions` step first. Common issues are invalid Supabase credentials, incorrect project ref, or deploy script/function config errors.
