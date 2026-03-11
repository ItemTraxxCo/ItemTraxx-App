import fs from 'node:fs/promises';
import path from 'node:path';

const openapiPath = path.resolve('docs/api/generated/edge-contracts.openapi.json');
const schemaPath = path.resolve('docs/api/generated/edge-contracts.schema.json');
const outPath = path.resolve('docs/api/edge-endpoints.md');

const openapi = JSON.parse(await fs.readFile(openapiPath, 'utf8'));
const schemaDoc = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
const schemas = schemaDoc.schemas ?? {};

const endpointNotes = {
  '/functions/v1/admin-ops': 'Tenant admin operational actions used by the tenant admin panel.',
  '/functions/v1/super-tenant-mutate': 'Super-admin tenant and district creation/update actions.',
  '/functions/v1/super-admin-mutate': 'Super-admin account management for tenant and district admins.',
  '/functions/v1/super-ops': 'Super-admin operational controls, approvals, customer ops, and reporting.',
  '/functions/v1/tenant-admin-mutate': 'Primary-admin-only tenant admin management for the current tenant.',
  '/functions/v1/district-dashboard': 'District dashboard snapshot and analytics feed.',
  '/functions/v1/district-handoff': 'Cross-host login handoff for district-routed auth flows.',
  '/functions/v1/contact-sales-submit': 'Public contact-sales and request-demo form submit endpoint.',
  '/functions/v1/contact-support-submit': 'Public support form submit endpoint.',
};

const requestSchemaNameByPath = {
  '/functions/v1/admin-ops': 'adminOpsRequest',
  '/functions/v1/super-tenant-mutate': 'superTenantRequest',
  '/functions/v1/super-admin-mutate': 'superAdminRequest',
  '/functions/v1/super-ops': 'superOpsRequest',
  '/functions/v1/tenant-admin-mutate': 'tenantAdminManageRequest',
  '/functions/v1/district-handoff': 'districtHandoffRequest',
};

const responseSchemaNameByPath = {
  '/functions/v1/admin-ops': 'adminOpsResponses',
  '/functions/v1/super-tenant-mutate': 'superTenantResponses',
  '/functions/v1/super-admin-mutate': 'superAdminResponses',
  '/functions/v1/super-ops': 'superOpsResponses',
  '/functions/v1/tenant-admin-mutate': 'tenantAdminManageResponses',
  '/functions/v1/district-dashboard': 'districtDashboardResponse',
  '/functions/v1/district-handoff': 'districtHandoffResponses',
  '/functions/v1/contact-sales-submit': 'contactSalesSubmitResponse',
  '/functions/v1/contact-support-submit': 'contactSupportSubmitResponse',
};

function getOneOfActions(schemaName) {
  const schema = schemas[schemaName];
  if (!schema?.oneOf) return [];
  return schema.oneOf
    .map((entry) => {
      const action = entry?.properties?.action?.const;
      if (!action) return null;
      const payloadProps = entry.properties?.payload?.properties ?? {};
      const payloadRequired = new Set(entry.properties?.payload?.required ?? []);
      const topLevelProps = Object.keys(entry.properties ?? {}).filter((key) => !['action', 'payload'].includes(key));
      const lines = [];
      for (const [name, prop] of Object.entries(payloadProps)) {
        const type = Array.isArray(prop.type) ? prop.type.join('|') : prop.type ?? (prop.enum ? 'enum' : 'any');
        lines.push(`- \`${name}\`${payloadRequired.has(name) ? ' (required)' : ''}: ${type}`);
      }
      for (const name of topLevelProps) {
        const prop = entry.properties[name] ?? {};
        const type = Array.isArray(prop.type) ? prop.type.join('|') : prop.type ?? (prop.enum ? 'enum' : 'any');
        const required = (entry.required ?? []).includes(name);
        lines.push(`- \`${name}\`${required ? ' (required)' : ''}: ${type}`);
      }
      return { action, fields: lines };
    })
    .filter(Boolean);
}

function responseKeys(schemaName) {
  const schema = schemas[schemaName];
  if (!schema?.properties) return [];
  return Object.keys(schema.properties);
}

const lines = [];
lines.push('# Edge Endpoint Reference');
lines.push('');
lines.push('Human-readable summary generated from the current OpenAPI and JSON Schema artifacts.');
lines.push('');
lines.push('Generated from:');
lines.push('- `/docs/api/generated/edge-contracts.openapi.json`');
lines.push('- `/docs/api/generated/edge-contracts.schema.json`');
lines.push('');
lines.push(`Generated at: ${new Date().toISOString()}`);
lines.push('');

for (const [route, methods] of Object.entries(openapi.paths ?? {})) {
  const method = Object.keys(methods)[0];
  const op = methods[method];
  const requestSchemaName = requestSchemaNameByPath[route];
  const responseSchemaName = responseSchemaNameByPath[route];
  lines.push(`## \`${method.toUpperCase()} ${route}\``);
  lines.push('');
  if (op.summary) lines.push(op.summary);
  if (endpointNotes[route]) lines.push('', endpointNotes[route]);
  lines.push('');
  if (requestSchemaName) {
    const actions = getOneOfActions(requestSchemaName);
    if (actions.length) {
      lines.push('### Supported actions');
      lines.push('');
      for (const item of actions) {
        lines.push(`#### \`${item.action}\``);
        if (item.fields.length) {
          lines.push('');
          lines.push(...item.fields);
        } else {
          lines.push('');
          lines.push('- No additional fields.');
        }
        lines.push('');
      }
    } else {
      lines.push('### Request body');
      lines.push('');
      lines.push(`- Schema: \`${requestSchemaName}\``);
      lines.push('');
    }
  } else {
    lines.push('### Request');
    lines.push('');
    lines.push('- No action-based request body.');
    lines.push('');
  }

  if (responseSchemaName) {
    const keys = responseKeys(responseSchemaName);
    lines.push('### Response schema');
    lines.push('');
    lines.push(`- Schema: \`${responseSchemaName}\``);
    if (keys.length) {
      lines.push(`- Top-level keys: ${keys.map((k) => `\`${k}\``).join(', ')}`);
    }
    lines.push('');
  }
}

await fs.writeFile(outPath, lines.join('\n'), 'utf8');
console.log(`wrote ${outPath}`);
