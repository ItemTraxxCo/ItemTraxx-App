import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const root = process.cwd();
const generatedContractsPath = "docs/api/generated/edge-contracts.schema.json";

const endpoints = [
  {
    name: "admin-ops",
    registryPath: "supabase/functions/admin-ops/actions/index.ts",
    registryName: "ADMIN_OPS_ACTIONS",
    requestSchema: "adminOpsRequest",
    responseSchema: "adminOpsResponses",
    responseMapName: "adminOpsResponseSchemas",
  },
  {
    name: "super-ops",
    registryPath: "supabase/functions/super-ops/actions/index.ts",
    registryName: "SUPER_OPS_ACTIONS",
    requestSchema: "superOpsRequest",
    responseSchema: "superOpsResponses",
    responseMapName: "superOpsResponseSchemas",
  },
];

const unwrapExpression = (node) => {
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return unwrapExpression(node.expression);
  }
  return node;
};

const assertUnique = (actions, label) => {
  const duplicates = actions.filter((action, index) => actions.indexOf(action) !== index);
  assert.deepEqual([...new Set(duplicates)].sort(), [], `${label} contains duplicate actions`);
};

export const readRegistryActions = (source, registryName, sourcePath = "registry.ts") => {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== registryName) continue;
      const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
      assert.ok(
        initializer && ts.isArrayLiteralExpression(initializer),
        `${registryName} must be a literal array`,
      );
      return initializer.elements.map((element) => {
        const value = unwrapExpression(element);
        assert.ok(
          ts.isStringLiteralLike(value),
          `${registryName} must contain only string literals`,
        );
        return value.text;
      });
    }
  }

  assert.fail(`${registryName} was not found in ${sourcePath}`);
};

const readStaticPropertyName = (property, mapName) => {
  assert.ok(!ts.isSpreadAssignment(property), `${mapName} must not contain spread properties`);
  const name = property.name;
  assert.ok(name, `${mapName} must contain only named response properties`);
  assert.ok(
    ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name),
    `${mapName} response properties must use static names`,
  );
  return name.text;
};

export const readResponseMapActions = (
  source,
  mapName,
  sourcePath = "edgeSchemas.mjs",
) => {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== mapName) continue;
      const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
      assert.ok(
        initializer && ts.isObjectLiteralExpression(initializer),
        `${mapName} must be an object literal`,
      );
      const actions = initializer.properties.map((property) =>
        readStaticPropertyName(property, mapName)
      );
      assertUnique(actions, `${mapName} authoritative response map`);
      return actions;
    }
  }

  assert.fail(`${mapName} was not found in ${sourcePath}`);
};

export const requestActionsFromJsonSchema = (schema) => {
  assert.ok(Array.isArray(schema.oneOf), "request schema must be a oneOf action union");
  return schema.oneOf.map((option) => {
    const action = option?.properties?.action?.const;
    assert.equal(typeof action, "string", "every request union member must have an action const");
    return action;
  });
};

export const responseActionsFromJsonSchema = (schema) => {
  assert.equal(schema.type, "object", "response schema must be an action-keyed object");
  assert.ok(schema.properties, "response schema must declare action properties");
  return Object.keys(schema.properties);
};

export const assertActionParity = ({ endpoint, registry, request, response }) => {
  assertUnique(registry, `${endpoint} runtime registry`);
  assertUnique(request, `${endpoint} request contract`);
  assertUnique(response, `${endpoint} response contract`);

  const expected = [...registry].sort();
  assert.deepEqual([...request].sort(), expected, `${endpoint} request actions differ from runtime`);
  assert.deepEqual([...response].sort(), expected, `${endpoint} response actions differ from runtime`);
};

export const inspectEdgeActionContractParity = async () => {
  const generatedContracts = JSON.parse(
    await fs.readFile(path.join(root, generatedContractsPath), "utf8"),
  );
  const schemaSourcePath = "src/types/edgeSchemas.mjs";
  const schemaSource = await fs.readFile(path.join(root, schemaSourcePath), "utf8");
  const results = [];
  for (const endpoint of endpoints) {
    const registrySource = await fs.readFile(path.join(root, endpoint.registryPath), "utf8");
    const registry = readRegistryActions(
      registrySource,
      endpoint.registryName,
      endpoint.registryPath,
    );
    const request = requestActionsFromJsonSchema(
      generatedContracts.schemas[endpoint.requestSchema],
    );
    const response = responseActionsFromJsonSchema(
      generatedContracts.schemas[endpoint.responseSchema],
    );
    const authoritativeResponse = readResponseMapActions(
      schemaSource,
      endpoint.responseMapName,
      schemaSourcePath,
    );

    assertActionParity({ endpoint: endpoint.name, registry, request, response });
    assert.deepEqual(
      [...authoritativeResponse].sort(),
      [...registry].sort(),
      `${endpoint.name} authoritative response actions differ from runtime`,
    );
    results.push({ endpoint: endpoint.name, count: registry.length });
  }
  return results;
};

const isDirectRun = process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const results = await inspectEdgeActionContractParity();
  console.log(
    `Edge action contracts match runtime registries (${results.map(({ endpoint, count }) => `${endpoint}: ${count}`).join(", ")}).`,
  );
}
