# Edge API Contracts and Typed Client Notes

## Typed Contract Source
- `/src/types/edgeContracts.ts`

This file centralizes shared action unions and envelope shapes used by frontend edge-service clients.

## Covered Clients
- `adminOpsService`
- `superTenantService`
- `superAdminService`
- `superGearService`
- `superStudentService`
- `superLogsService`

## Contract Pattern
- Request body:
  - `{ action: <ActionUnion>, payload: Record<string, unknown> }`
- Response body:
  - `{ data?: T }` on success for service consumers.

## Why this helps
- Compile-time guardrails for edge action names.
- Lower risk of action-string drift across UI modules.
- Easier future automation for OpenAPI/JSON-schema generation.

## Generated schema
- Generated JSON Schema: `/docs/api/generated/edge-contracts.schema.json`
- Generated OpenAPI wrapper: `/docs/api/generated/edge-contracts.openapi.json`
- Human-readable endpoint reference: `/docs/api/edge-endpoints.md`
- Source types: `/src/types/edgeContracts.ts`
- Source validators: `/src/types/edgeSchemas.mjs`
- Regenerate with: `npm run docs:edge-schemas`, `npm run docs:edge-openapi`, or `npm run docs:edge-reference`

## Current coverage
- `admin-ops` request/response contracts
- `super-tenant-mutate` request/response contracts
- `tenant-admin-mutate` request/response contracts
- `super-admin-mutate` request/response contracts
- `super-ops` request/response contracts
- `district-dashboard` response contract
- `district-handoff` request/response contracts
- `contact-sales-submit` request/response contracts
- `contact-support-submit` request/response contracts

## Next step
- Expand the schema set to cover remaining edge functions with high churn and, if useful, publish the generated OpenAPI artifact through the docs site.
