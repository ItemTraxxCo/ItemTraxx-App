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

## Next step
- Generate JSON schema/OpenAPI docs from `edgeContracts.ts` + zod validators and publish to docs site.
