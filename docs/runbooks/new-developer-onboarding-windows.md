# New Developer Onboarding (Windows)

This document is the Windows-specific onboarding procedure for a new ItemTraxx developer.

This repo can be developed on Windows, but the recommended setup is:

- Windows 11
- WSL2
- Ubuntu inside WSL2
- VS Code with the WSL extension

That setup avoids most shell and script compatibility issues.

## 1. Recommended Setup Path

Use this path unless there is a reason not to:

1. Install WSL2.
2. Install Ubuntu through WSL2.
3. Install all development tools inside Ubuntu, not in PowerShell.
4. Clone and work on the repo from the Linux home directory inside WSL2.
5. Run all repo commands from the WSL terminal.

## 2. Before Starting

A team lead must provide:

- GitHub repository access to `ItemTraxxCo/ItemTraxx-App`
- Slack access
- the required `.env` values through a secure channel
- confirmation of whether manual deploy access is required
- confirmation of whether Supabase and Cloudflare access are required

## 3. Install WSL2 And Ubuntu

### Install WSL2

Open PowerShell as Administrator and run:

```powershell
wsl --install
```

Then restart the machine if prompted.

### Install Ubuntu

After restart, install Ubuntu from the Microsoft Store if it was not installed automatically.

Then launch Ubuntu and complete first-time setup:

- create your Linux username
- create your Linux password

## 4. Open A Linux Shell

After Ubuntu is installed, open the Ubuntu app or run:

```powershell
wsl
```

All remaining commands in this guide should be run inside the Ubuntu shell unless stated otherwise.

## 5. Install Required Tools Inside WSL2 Ubuntu

Run:

```bash
sudo apt update
sudo apt install -y curl git unzip build-essential ca-certificates gnupg
```

### Install Node.js

Use the NodeSource install flow for Node 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Install GitHub CLI

```bash
(type -p wget >/dev/null || sudo apt install wget -y) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt update \
  && sudo apt install gh -y
```

### Install Deno

```bash
curl -fsSL https://deno.land/install.sh | sh
```

Then add Deno to your shell profile if needed:

```bash
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Install Supabase CLI

```bash
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://cli.supabase.com/pubkey.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/supabase.gpg
echo "deb [signed-by=/etc/apt/keyrings/supabase.gpg] https://cli.supabase.com/deb stable main" | sudo tee /etc/apt/sources.list.d/supabase.list
sudo apt update
sudo apt install -y supabase
```

### Install Wrangler

```bash
npm install --global wrangler
```

## 6. Verify Installed Tools

Run:

```bash
git --version
node --version
npm --version
gh --version
deno --version
supabase --version
wrangler --version
```

If any command fails, stop and fix that before continuing.

## 7. Authenticate Required CLIs

### GitHub CLI

```bash
gh auth login
gh auth status
```

### Supabase CLI

Only if manual deploy access is required:

```bash
supabase login
supabase projects list
```

### Wrangler

Only if manual Cloudflare deploy access is required:

```bash
wrangler login
wrangler whoami
```

## 8. Clone The Repo Inside WSL2

Do not clone into a Windows-mounted path like `/mnt/c/...` unless you have a specific reason.

Recommended:

```bash
cd ~
git clone git@github.com:ItemTraxxCo/ItemTraxx-App.git
cd ItemTraxx-App
```

If SSH is not configured:

```bash
git clone https://github.com/ItemTraxxCo/ItemTraxx-App.git
cd ItemTraxx-App
```

Confirm repo root:

```bash
git rev-parse --show-toplevel
```

## 9. Install Project Dependencies

```bash
npm install
```

## 10. Create The Local Environment File

```bash
cp .env.example .env
```

Then open `.env` and fill in the values provided securely by the team lead.

Do not commit `.env`.

## 11. Verify Local Build

```bash
npm run build
npm run perf:budget
```

## 12. Run The App Locally

```bash
npm run dev
```

Then open the local URL shown by Vite, usually:

- `http://localhost:5173`

Confirm:

- landing page loads
- login page loads
- no immediate terminal crash

## 13. Current Git Workflow

Start from the shared integration branch:

```bash
git fetch origin
git checkout preview
git pull origin preview
git checkout -b your-branch-name
```

When ready:

```bash
git add .
git commit -m "describe your change"
git push -u origin your-branch-name
```

Then open a PR into:

- `preview`

## 14. Manual Deploys From Windows/WSL2

If the developer has deploy access, run these from the repo root inside WSL2.

### Supabase functions

```bash
npm run deploy:supabase:functions
```

### Cloudflare worker

```bash
npm run deploy:cloudflare:worker
```

These do not depend on Dennis-specific local paths.

## 15. Windows-Specific Notes

1. Prefer WSL2 over PowerShell for repo work.
2. Prefer storing the repo in the Linux filesystem, not `/mnt/c/...`.
3. If using VS Code, use the `Remote - WSL` extension.
4. If Playwright or browser tooling has issues, install dependencies from inside WSL2 and rerun.
5. If line-ending problems appear, check Git settings:

```bash
git config --global core.autocrlf input
```

## 16. Minimum Smoke Test

A new Windows developer is onboarded only when all of these work:

1. `gh auth status`
2. `npm install`
3. `.env` exists and is filled
4. `npm run build`
5. `npm run perf:budget`
6. `npm run dev`
7. landing page loads locally
8. login page loads locally
9. if deploy access is needed, `supabase projects list`
10. if deploy access is needed, `wrangler whoami`

If any item fails, stop and fix that before production-impacting work begins.
