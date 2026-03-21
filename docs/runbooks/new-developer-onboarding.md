# New Developer Onboarding

This document is the step-by-step onboarding procedure for a new ItemTraxx developer.

Do not skip steps. If a step cannot be completed, stop there and resolve that blocker before moving forward.

## 1. What This Onboarding Covers

By the end of this onboarding, the developer will be able to:

- access the ItemTraxx GitHub repository
- clone the repository locally
- install every required local tool
- create the required local environment file
- run the app locally
- build and validate the repo locally
- understand the current branch and pull request workflow
- understand how automatic deploys work
- manually deploy Supabase functions and the Cloudflare worker from any machine without using a Dennis-specific home-directory path

## 2. Access Checklist Before Touching The Repo

A team lead or repo admin must confirm all required access before the developer starts setup.

### Required access for every developer

1. GitHub account created and verified.
2. GitHub access granted to the ItemTraxx repository:
- repository: `ItemTraxxCo/ItemTraxx-App`
- minimum access: `Write`

3. Access to the current source-of-truth communication channel:
- Slack workspace/channel used by the engineering team

4. Access to the current secret-sharing location used by the team lead.
- The developer must be able to receive the current local `.env` values securely.
- Never send secrets in plain chat if your team has a password manager or vault.

### Additional access for developers who need manual deploy ability

These are only required if the developer should be allowed to manually deploy infrastructure from a terminal.

1. Supabase project access for the ItemTraxx project.
2. Cloudflare account access for the `itemtraxx.com` zone and the `itemtraxx-edge-proxy` worker.
3. Permission to use the Supabase CLI against the production project.
4. Permission to use Wrangler against the production Cloudflare account.

### Additional access for repo administrators

These are required for the GitHub Actions deploy automation to work.

GitHub repository secrets that must exist:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SLACK_WEBHOOK_URL` (already used by failure notifications)

If these secrets do not exist, automatic deploys will not work.

## 3. Install Required Software On The Developer Machine

Run every command exactly as written unless your team lead tells you otherwise.

### macOS setup with Homebrew

1. Install Homebrew if it is not already installed.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install Git.

```bash
brew install git
```

3. Install Node.js.

```bash
brew install node
```

4. Install GitHub CLI.

```bash
brew install gh
```

5. Install Deno.

```bash
brew install deno
```

6. Install the Supabase CLI.

```bash
brew install supabase/tap/supabase
```

7. Install Wrangler.

```bash
npm install --global wrangler
```

8. Confirm the tools are installed.

```bash
git --version
node --version
npm --version
gh --version
deno --version
supabase --version
wrangler --version
```

If any command fails, stop and fix that tool before continuing.

## 4. Sign In To Required CLIs

### GitHub CLI login

1. Run:

```bash
gh auth login
```

2. Choose:
- `GitHub.com`
- `HTTPS`
- authenticate in browser

3. Confirm login:

```bash
gh auth status
```

### Supabase CLI login

This is required for developers who will manually deploy functions.

1. Run:

```bash
supabase login
```

2. Complete browser authentication or token flow.

3. Confirm the CLI works:

```bash
supabase projects list
```

If this fails, stop and confirm the developer actually has Supabase project access.

### Wrangler login

This is required for developers who will manually deploy the Cloudflare worker.

1. Run:

```bash
wrangler login
```

2. Complete browser authentication.

3. Confirm access:

```bash
wrangler whoami
```

If this fails, stop and confirm the developer has the correct Cloudflare account access.

## 5. Clone The Repository

1. Choose the directory where the repo should live.
2. Run:

```bash
git clone git@github.com:ItemTraxxCo/ItemTraxx-App.git
```

If SSH is not configured, use HTTPS instead:

```bash
git clone https://github.com/ItemTraxxCo/ItemTraxx-App.git
```

3. Enter the repo:

```bash
cd ItemTraxx-App
```

4. Confirm the current directory is the repo root:

```bash
git rev-parse --show-toplevel
```

The command must print the full path to the cloned repo.

## 6. Switch To Your Personal Developer Branch

Each developer should work from their own long-lived branch named:

```text
dev/<github-username>
```

Examples:

- `dev/mmango10`
- `dev/leotheoeo`

1. Fetch remote branches:

```bash
git fetch origin
```

2. If your personal branch already exists on GitHub, switch to it:

```bash
git checkout dev/<github-username>
```

3. If it does not exist yet, create it from `preview` and push it:

```bash
git checkout preview
git pull origin preview
git checkout -b dev/<github-username>
git push -u origin dev/<github-username>
```

4. Confirm you are now on your personal branch:

```bash
git branch --show-current
```

Do not do normal development work directly on `main` or `preview`.

## 7. Install Repository Dependencies

From the repo root, run:

```bash
npm install
```

Do not continue until `npm install` completes successfully.

## 8. Create The Local Environment File

1. Copy the sample environment file.

```bash
cp .env.example .env
```

2. Open `.env` in your editor.
3. Fill in the required values provided by the team lead.

Current public/local variables expected by the repo are defined in `.env.example`.

At minimum, verify these keys exist in `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_EDGE_PROXY_URL`
- `VITE_USE_EDGE_PROXY_IN_DEV`
- `VITE_TURNSTILE_SITE_KEY`
- `VITE_LOGO_URL`
- `VITE_LEGAL_URL`
- `VITE_TERMS_URL`
- `VITE_PRIVACY_URL`
- `ITX_ALLOWED_ORIGINS`

4. Save `.env`.
5. Do not commit `.env`.

If `.env` changes later, restart the dev server after editing it.

## 9. Verify The Repository Builds Cleanly

From the repo root, run these commands in order.

```bash
npm run build
npm run perf:budget
```

If either command fails, stop and resolve that failure before continuing.

## 10. Run The App Locally

1. Start the dev server.

```bash
npm run dev
```

2. Open the local URL printed by Vite. It is usually:

- `http://localhost:5173`

3. Confirm the landing page loads.
4. Confirm the login page loads.
5. Confirm there is no immediate console or terminal crash.

## 11. Optional Local Verification Commands

These are the standard validation commands developers should know.

### Build

```bash
npm run build
```

### Bundle budget

```bash
npm run perf:budget
```

### End-to-end tests

```bash
npm run test:e2e
```

### Security gate

```bash
npm run security:gate
```

Do not run all of these blindly on every small change. Use them when the change justifies it.

## 12. Current Git Workflow

The current repo uses GitHub plus branch-based collaboration.

### Start a new task

1. Make sure your local repo is clean.

```bash
git status
```

2. Fetch the latest refs.

```bash
git fetch origin
```

3. Switch to your personal developer branch.

```bash
git checkout dev/<github-username>
```

4. Pull the latest remote commits for your branch.

```bash
git pull origin dev/<github-username>
```

5. Merge the latest shared integration changes into your branch.

```bash
git merge origin/preview
```

6. If you are using short-lived task branches, create one from your personal branch.

```bash
git checkout -b <your-task-branch-name>
```

If you are not using short-lived task branches, you can work directly on your personal developer branch.

### Push a branch

If you are working directly on your personal developer branch:

```bash
git push
```

If you are working on a short-lived task branch:

```bash
git push -u origin <your-task-branch-name>
```

### Open a pull request

If your team uses one long-lived personal branch per developer, open the PR from:

- `dev/<github-username>`

into:

- `preview`

If you are using a short-lived task branch, open the PR from that task branch into `preview`.

## 13. Automatic Deploys In GitHub Actions

The repo now includes GitHub Actions workflows for infrastructure deploys.

### Supabase functions auto-deploy

Workflow:

- `.github/workflows/deploy-supabase-functions.yml`

What it does:

- triggers on pushes to `main` when Supabase function files or Supabase function deploy config changes
- can also be run manually with `workflow_dispatch`
- deploys functions using the repo script `scripts/deploy-supabase-functions.py`

### Cloudflare worker auto-deploy

Workflow:

- `.github/workflows/deploy-cloudflare-worker.yml`

What it does:

- triggers on pushes to `main` when the worker files change
- can also be run manually with `workflow_dispatch`
- deploys the Cloudflare worker using the repo script `scripts/deploy-cloudflare-worker.sh`

### Important limitation

Automatic deploys only work if the required GitHub repository secrets already exist.

If a deploy workflow fails because a secret is missing, the fix is in GitHub repository settings, not in the app code.

## 14. Manual Deploys From Any Machine

These commands are repo-relative. They do not depend on `/Users/dennisfrenkel` or any other single developer home directory.

### Manual Supabase function deploy

From the repo root:

```bash
npm run deploy:supabase:functions
```

That deploys all tracked Supabase functions in the repo.

To deploy only specific functions:

```bash
npm run deploy:supabase:functions -- tenant-login login-notify
```

You can also call the Python script directly:

```bash
python3 ./scripts/deploy-supabase-functions.py tenant-login login-notify
```

If you need to explicitly target a project ref:

```bash
SUPABASE_PROJECT_REF=<your-project-ref> python3 ./scripts/deploy-supabase-functions.py tenant-login
```

### Manual Cloudflare worker deploy

From the repo root:

```bash
npm run deploy:cloudflare:worker
```

Or directly:

```bash
bash ./scripts/deploy-cloudflare-worker.sh
```

These commands work from any machine that has:

- the repo cloned locally
- the required CLI installed
- the required auth already configured

## 15. When To Use Automatic Deploys Vs Manual Deploys

### Use automatic deploys when

- the change is merged to `main`
- you want a normal audited deployment path
- there is no emergency in progress

### Use manual deploys when

- you are testing a deploy from a non-`main` branch
- you are doing controlled manual verification
- GitHub Actions is unavailable
- you are performing an emergency rollback or hotfix under an approved process

## 16. SQL Migrations Are Still Separate

Supabase function deploy automation does not automatically apply SQL migrations.

That means:

- SQL files under `supabase/sql/` still require an explicit review and execution step
- developers must not assume that pushing function code also updates database schema

If a change depends on SQL schema updates, those migration steps must be called out clearly in the PR and deployment notes.

## 17. Minimum New-Developer Smoke Test

Every newly onboarded developer should complete this smoke test after setup.

1. `git status` shows the repo is available locally.
2. `npm install` completes.
3. `.env` exists and is filled.
4. `npm run build` passes.
5. `npm run perf:budget` passes.
6. `npm run dev` starts successfully.
7. The landing page loads locally.
8. The login page loads locally.
9. `gh auth status` passes.
10. If deploy access is required, `supabase projects list` works.
11. If deploy access is required, `wrangler whoami` works.

If any item fails, stop and resolve it before assigning production-impacting work.

## 18. What The Team Lead Must Hand The New Developer

The team lead must provide all of the following directly.

1. The correct GitHub repository URL.
2. The current working branch strategy.
3. The current `.env` values through a secure channel.
4. The expected local test account or safe test flow.
5. Whether the developer should have deploy access.
6. Whether the developer should have Supabase dashboard access.
7. Whether the developer should have Cloudflare dashboard access.
8. Whether the developer should have Vercel dashboard access.

Do not expect a new developer to infer any of this.

## 19. Common Setup Failures

### `npm install` fails

Check:

- Node is installed
- npm is available
- the developer is in the repo root

### `npm run build` fails because env is missing

Check:

- `.env` exists
- `.env` contains the required keys
- the developer restarted the dev server after changing `.env`

### `supabase login` works but `supabase projects list` fails

Check:

- the developer actually has access to the correct Supabase organization/project

### `wrangler whoami` fails

Check:

- the developer completed `wrangler login`
- the developer has been granted the correct Cloudflare account permissions

### Auto deploy workflow fails

Check:

- GitHub repository secrets exist
- the branch/path trigger conditions were met
- the changed code is actually part of the deploy target

## 20. Current Files Related To Deploy And Onboarding

Key files in this repo:

- `.github/workflows/deploy-supabase-functions.yml`
- `.github/workflows/deploy-cloudflare-worker.yml`
- `scripts/deploy-supabase-functions.py`
- `scripts/deploy-cloudflare-worker.sh`
- `docs/runbooks/new-developer-onboarding.md`

## 21. Final Onboarding Completion Criteria

A developer is fully onboarded only when all of the following are true.

1. Repo access is confirmed.
2. Local tools are installed.
3. CLI logins are completed.
4. Repo is cloned locally.
5. Dependencies are installed.
6. `.env` is created and valid.
7. Local build passes.
8. Local app runs.
9. Branch workflow is understood.
10. Automatic deploy process is understood.
11. Manual deploy process is understood if the developer is expected to deploy.

Until all eleven are complete, onboarding is not finished.
