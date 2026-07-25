import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { generatedEdgeSchemas } from '../src/types/edgeSchemas.mjs';

const schemaOutPath = path.resolve(
  process.env.ITX_EDGE_SCHEMA_OUT_PATH || 'docs/api/generated/edge-contracts.schema.json'
);
const openapiOutPath = path.resolve(
  process.env.ITX_EDGE_OPENAPI_OUT_PATH || 'docs/api/generated/edge-contracts.openapi.json'
);

const generated = {
  source: {
    contracts: '/src/types/edgeContracts.ts',
    validators: '/src/types/edgeSchemas.mjs',
  },
  schemas: Object.fromEntries(
    Object.entries(generatedEdgeSchemas).map(([name, schema]) => [
      name,
      {
        title: name,
        ...z.toJSONSchema(schema),
      },
    ])
  ),
};

const envelopeRef = (name) => ({ '$ref': `#/components/schemas/${name}` });
const jsonContent = (schema) => ({ 'application/json': { schema } });
const errorSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    error: { type: 'string' },
  },
  required: ['error'],
};

const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'ItemTraxx Edge API Contracts',
    version: '0.1.0',
    description: 'Generated OpenAPI wrapper around shared edge-function JSON Schemas.',
  },
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  paths: {
    '/functions/v1/admin-ops': {
      post: {
        summary: 'Workspace admin operations',
        requestBody: { required: true, content: jsonContent(envelopeRef('adminOpsRequest')) },
        responses: { '200': { description: 'Successful response', content: jsonContent(envelopeRef('adminOpsResponses')) }, '400': { description: 'Error', content: jsonContent(errorSchema) } },
      },
    },
    '/functions/v1/super-workspace-mutate': {
      post: {
        summary: 'Super admin workspace mutations',
        requestBody: { required: true, content: jsonContent(envelopeRef('superWorkspaceRequest')) },
        responses: { '200': { description: 'Successful response', content: jsonContent(envelopeRef('superWorkspaceResponses')) }, '400': { description: 'Error', content: jsonContent(errorSchema) } },
      },
    },
    '/functions/v1/super-admin-mutate': {
      post: {
        summary: 'Super admin account mutations',
        requestBody: { required: true, content: jsonContent(envelopeRef('superAdminRequest')) },
        responses: { '200': { description: 'Successful response', content: jsonContent(envelopeRef('superAdminResponses')) }, '400': { description: 'Error', content: jsonContent(errorSchema) } },
      },
    },
    '/functions/v1/super-ops': {
      post: {
        summary: 'Super admin operations and reporting',
        requestBody: { required: true, content: jsonContent(envelopeRef('superOpsRequest')) },
        responses: { '200': { description: 'Successful response', content: jsonContent(envelopeRef('superOpsResponses')) }, '400': { description: 'Error', content: jsonContent(errorSchema) } },
      },
    },
    '/functions/v1/workspace-admin-mutate': {
      post: {
        summary: 'Primary Workspace Admin peer management',
        requestBody: { required: true, content: jsonContent(envelopeRef('workspaceAdminManageRequest')) },
        responses: { '200': { description: 'Successful response', content: jsonContent(envelopeRef('workspaceAdminManageResponses')) }, '400': { description: 'Error', content: jsonContent(errorSchema) } },
      },
    },
    '/functions/v1/contact-sales-submit': {
      post: {
        summary: 'Public contact sales/demo form submit',
        requestBody: { required: true, content: jsonContent(envelopeRef('contactSalesSubmitRequest')) },
        responses: { '200': { description: 'Successful response', content: jsonContent(envelopeRef('contactSalesSubmitResponse')) }, '400': { description: 'Error', content: jsonContent(errorSchema) } },
      },
    },
    '/functions/v1/contact-support-submit': {
      post: {
        summary: 'Public contact support form submit',
        requestBody: { required: true, content: jsonContent(envelopeRef('contactSupportSubmitRequest')) },
        responses: { '200': { description: 'Successful response', content: jsonContent(envelopeRef('contactSupportSubmitResponse')) }, '400': { description: 'Error', content: jsonContent(errorSchema) } },
      },
    },
  },
  components: {
    schemas: generated.schemas,
  },
};

await fs.mkdir(path.dirname(schemaOutPath), { recursive: true });
await fs.writeFile(schemaOutPath, JSON.stringify(generated, null, 2) + '\n', 'utf8');
await fs.writeFile(openapiOutPath, JSON.stringify(openapi, null, 2) + '\n', 'utf8');
console.log(`wrote ${schemaOutPath}`);
console.log(`wrote ${openapiOutPath}`);
