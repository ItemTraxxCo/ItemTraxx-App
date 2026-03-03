# System Architecture Overview

This document describes the high-level ItemTraxx architecture across frontend, edge functions, and Supabase data domains, plus the core request flows.

## 1) Runtime Topology

```mermaid
flowchart LR
  U[User Browser] --> CF[Cloudflare DNS/WAF/CDN]
  CF --> V[Vercel Hosting]
  V --> SPA[ItemTraxx Vue SPA]

  SPA -->|Public routes| PUB[Public Pages]
  SPA -->|Tenant checkout/admin routes| TEN[Tenant App]
  SPA -->|Super/internal routes| INT[Internal & Super Admin App]

  TEN --> EFC[Edge Function Client]
  INT --> EFC
  PUB --> EFC

  EFC -->|Prod default| PROXY[Cloudflare Edge Proxy]
  EFC -->|Dev fallback or no proxy| SFE[Supabase Edge Functions]
  PROXY --> SFE

  SFE --> AUTH[(Supabase Auth\nJWT / sessions)]
  SFE --> TENDB[(Tenant Domain\nstudents, gear, transactions, settings)]
  SFE --> SALESDB[(Sales Domain\nsales_leads, customers, customer_status_logs)]
  SFE --> PLATFORMDB[(Platform Domain\nprofiles, audit logs, runtime config, alerts, jobs)]

  SPA --> ANALYTICS[Vercel Analytics / Speed Insights]
```

## 2) Primary Edge Functions

- Tenant-facing:
  - `tenant-login`
  - `checkoutReturn`
  - `admin-ops`
  - `admin-student-mutate`
  - `admin-gear-mutate`
- Super/internal:
  - `super-ops`
  - `super-dashboard`
  - `super-tenant-mutate`
  - `super-student-mutate`
  - `super-gear-mutate`
- Platform/public:
  - `system-status`
  - `contact-sales-submit`
  - `job-worker`

## 3) Request Flow: Tenant Login

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant SPA as Vue App (/tenant/admin-login or /login)
  participant EFC as edgeFunctionClient
  participant PX as Cloudflare Edge Proxy
  participant TL as tenant-login
  participant SA as Supabase Auth
  participant DB as Supabase DB

  B->>SPA: Submit credentials/access code
  SPA->>EFC: invokeEdgeFunction("tenant-login")
  EFC->>PX: POST /functions/tenant-login (Bearer token if present)
  PX->>TL: Forward allowed function call
  TL->>SA: Validate auth/session path
  TL->>DB: Validate tenant + role/profile constraints
  TL-->>PX: Auth result + role context
  PX-->>EFC: Response (+ x-request-id)
  EFC-->>SPA: Success or structured error
  SPA-->>B: Route to tenant/admin area or show sign-in error
```

## 4) Request Flow: Checkout / Return (+ Offline Buffer)

```mermaid
sequenceDiagram
  autonumber
  participant U as Tenant User
  participant SPA as Checkout UI
  participant Q as Offline Queue
  participant EFC as edgeFunctionClient
  participant PX as Edge Proxy
  participant CR as checkoutReturn
  participant DB as Tenant Tables

  U->>SPA: Submit checkout/return payload
  SPA->>EFC: invokeEdgeFunction("checkoutReturn")

  alt Network available and request succeeds
    EFC->>PX: POST /functions/checkoutReturn
    PX->>CR: Forward request
    CR->>DB: Write transaction + item/student updates
    DB-->>CR: Commit
    CR-->>SPA: Success
    SPA-->>U: Confirmed transaction
  else Network timeout/failure
    EFC-->>SPA: Network error/timeout
    SPA->>Q: Persist operation locally
    SPA-->>U: Queued for auto-sync
    Note over SPA,Q: On reconnect, flush FIFO queue
    SPA->>EFC: Retry queued operation
    EFC->>PX: POST /functions/checkoutReturn
    PX->>CR: Process replayed request
    CR->>DB: Commit
    CR-->>SPA: Success
    SPA->>Q: Remove completed item
  end
```

## 5) Request Flow: Tenant Admin Data Operations

```mermaid
sequenceDiagram
  autonumber
  participant A as Tenant Admin
  participant UI as Admin UI
  participant EFC as edgeFunctionClient
  participant PX as Edge Proxy
  participant AO as admin-ops / admin-student-mutate / admin-gear-mutate
  participant SA as Supabase Auth
  participant DB as Tenant + Platform tables

  A->>UI: Open students/logs/settings
  UI->>EFC: invokeEdgeFunction(...)
  EFC->>PX: POST /functions/<admin-function>
  PX->>AO: Forward allowed function
  AO->>SA: Validate JWT/session
  AO->>DB: Enforce tenant scope + execute action
  DB-->>AO: Data / mutation result
  AO-->>UI: Structured response envelope
  UI-->>A: Render table/state/toast
```

## 6) Request Flow: Super/Internal + Async Jobs

```mermaid
flowchart LR
  SAUI[Super Admin / Internal UI] --> EFC[edgeFunctionClient]
  EFC --> PX[Edge Proxy]
  PX --> SO[super-ops / super-dashboard]
  SO --> PDB[(Platform Tables)]
  SO --> SDB[(Sales Tables)]
  SO --> TDB[(Tenant Tables)]

  SAUI --> CSS[contact-sales-submit]
  CSS --> ASYNC[(async_jobs)]
  ASYNC --> JW[job-worker]
  JW --> RV[refresh_reporting_views]
  JW --> RESEND[Resend Email API]
  RV --> REPORT[(Materialized Reporting Views)]
```

## 7) Security Boundaries (At a Glance)

- Edge ingress control:
  - Cloudflare WAF/challenge at public edge.
  - Proxy allowlist restricts exposed function surface.
- Application security:
  - JWT/session checks in edge handlers.
  - Role/tenant scope enforcement in server logic.
- Data security:
  - Supabase RLS and role-based access.
  - Platform audit logs and runtime controls for privileged operations.

## 8) Operational Notes

- `edgeFunctionClient` includes:
  - request timeout guard
  - request ID propagation (`x-request-id`)
  - one-time token refresh retry on 401
  - dev fallback from proxy to direct Supabase functions when configured
- Status and observability:
  - `system-status` supports in-app status indicator and operational checks
  - CI + E2E + security workflows gate preview/main changes

## 9) CI/CD, Security, and Environment Boundaries

```mermaid
flowchart LR
  DEV[VS Code] --> GH[GitHub]
  GH --> PREVIEW[preview branch]
  PREVIEW --> PR[PR review]
  PR --> MAIN[main branch]
  MAIN --> VDEPLOY[Vercel deploy]
  VDEPLOY --> PROD[Production app]

  GH --> CI[CI Core]
  GH --> E2E[E2E Tests]
  GH --> SAUDIT[Security Audit]
  GH --> DHEALTH[Deployment Health]
  GH --> SYN[Synthetic Journeys]

  SECRETS[Secrets / Env Boundaries] --> FENV[Frontend public env]
  SECRETS --> EPX[Edge proxy secrets]
  SECRETS --> SFS[Supabase function secrets]
  SECRETS --> GAS[GitHub Actions secrets]
  SFS --> JOBW[Async Job Worker]
  GAS --> BACKUP[Supabase Backup]

  PROD --> CFWAF[Cloudflare WAF / bot challenge]
  PROD --> CSP[CSP / HSTS / frame protections]
  PROD --> RLS[Supabase RLS + role-based authz]
  PROD --> EALLOW[Edge proxy CORS + allowed functions]
  PROD --> VANA[Vercel Analytics]
  PROD --> VSI[Speed Insights]
  PROD --> STATUS[System status checks]
  STATUS --> AUD[(audit + job logs)]
```

## 10) Super/Internal and Async Processing Flow

```mermaid
flowchart LR
  subgraph UIs[Operational UIs]
    SAUI[Super Admin UI]
    IOPS[Internal Ops UI]
    TAUI[Tenant Admin UI]
  end

  SAUI --> SOPS[super-ops function]
  IOPS --> SOPS
  TAUI --> AOPS[admin-ops function]
  IOPS --> MMODE[Maintenance mode]
  MMODE --> MOVERLAY[Maintenance overlay]

  subgraph CAPS[Super/Internal Capabilities]
    CTRL[Control Center\\nruntime config, alerts, approvals, jobs]
    LEADS[Sales leads\\nstage, close, delete, convert]
    CUST[Customers\\ninvoice status entries/history]
    SNAP[Internal snapshot\\ntraffic / queue / SLA / audit]
  end

  SOPS --> CTRL
  SOPS --> LEADS
  SOPS --> CUST
  SOPS --> SNAP

  subgraph CORE[Core Tables]
    PROFILES[(profiles / role checks)]
    SALOG[(super_admin_audit_logs)]
    SALES[(sales_leads / customers / customer_status_logs)]
    CFG[(super_jobs / super_alert_rules / app_runtime_config)]
    TENANT[(tenant tables)]
  end

  SOPS --> PROFILES
  SOPS --> SALOG
  SOPS --> SALES
  SOPS --> CFG
  AOPS --> TENANT

  subgraph ASYNC[Async Processing]
    AJ[(async_jobs)]
    JW[job-worker function]
    RV[refresh_reporting_views job]
    CSJ[contact_sales_email job]
  end

  LEADS --> AJ
  CTRL --> AJ
  AJ --> JW
  JW --> RV
  JW --> CSJ
  CSJ --> RESEND[Resend API]
```

## 11) Combined End-to-End View (Simplified)

```mermaid
flowchart TB
  USER[Public / Tenant / Admin / Super Admin Users] --> EDGE[Cloudflare + Vercel]
  EDGE --> SPAAPP[ItemTraxx Vue SPA]
  SPAAPP --> CLIENT[edgeFunctionClient]
  CLIENT --> PROXY[Cloudflare Edge Proxy]
  PROXY --> FN[Supabase Edge Functions]
  FN --> AUTH[(Supabase Auth)]
  FN --> DBS[(Tenant + Sales + Platform Tables)]
  FN --> JOB[(async_jobs)]
  JOB --> WORKER[job-worker]
  WORKER --> REPORT[(reporting views)]
  WORKER --> EMAIL[Resend API]
  FN --> STATUSFN[system-status]
  STATUSFN --> SPAAPP
```
