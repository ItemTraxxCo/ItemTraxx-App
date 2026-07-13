import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertActionParity,
  inspectEdgeActionContractParity,
  readRegistryActions,
  readResponseMapActions,
} from "./check-edge-action-contract-parity.mjs";

test("extracts literal action registries without executing Deno modules", () => {
  assert.deepEqual(
    readRegistryActions(
      'export const ACTIONS = ["first", "second"] as const;',
      "ACTIONS",
    ),
    ["first", "second"],
  );
});

test("rejects missing, extra, and duplicate contract actions", () => {
  assert.throws(
    () => assertActionParity({ endpoint: "fixture", registry: ["a", "b"], request: ["a"], response: ["a", "b"] }),
    /request actions differ from runtime/,
  );
  assert.throws(
    () => assertActionParity({ endpoint: "fixture", registry: ["a"], request: ["a", "b"], response: ["a"] }),
    /request actions differ from runtime/,
  );
  assert.throws(
    () => assertActionParity({ endpoint: "fixture", registry: ["a"], request: ["a", "a"], response: ["a"] }),
    /request contract contains duplicate actions/,
  );
});

test("rejects duplicate declarations in an authoritative response map", () => {
  assert.throws(
    () => readResponseMapActions(
      "const responses = { first: schema, first: otherSchema };",
      "responses",
    ),
    /contains duplicate actions/,
  );
});

test("runtime registries have exact generated request and response coverage", async () => {
  assert.deepEqual(await inspectEdgeActionContractParity(), [
    { endpoint: "admin-ops", count: 11 },
    { endpoint: "super-ops", count: 26 },
    { endpoint: "super-tenant-mutate", count: 10 },
  ]);
});

const assertRequiredBooleanOk = (responses, endpoint) => {
  for (const [action, response] of Object.entries(responses.properties)) {
    assert.deepEqual(
      response.properties?.ok,
      { type: "boolean" },
      `${endpoint}.${action} must declare a top-level boolean ok`,
    );
    assert.ok(
      response.required?.includes("ok"),
      `${endpoint}.${action} must require top-level ok`,
    );
  }
};

test("all generated super-ops action responses require top-level boolean ok", async () => {
  const contracts = JSON.parse(
    await readFile(new URL("../docs/api/generated/edge-contracts.schema.json", import.meta.url), "utf8"),
  );

  assertRequiredBooleanOk(contracts.schemas.superOpsResponses, "super-ops");
});

test("all generated super-tenant action responses require top-level boolean ok", async () => {
  const contracts = JSON.parse(
    await readFile(new URL("../docs/api/generated/edge-contracts.schema.json", import.meta.url), "utf8"),
  );

  assertRequiredBooleanOk(contracts.schemas.superTenantResponses, "super-tenant-mutate");
});

test("generated internal ops snapshot matches the live response shape", async () => {
  const contracts = JSON.parse(
    await readFile(new URL("../docs/api/generated/edge-contracts.schema.json", import.meta.url), "utf8"),
  );
  const snapshot = contracts.schemas.superOpsResponses.properties
    .get_internal_ops_snapshot.properties.data;
  const keys = (schema) => Object.keys(schema.properties).sort();

  assert.deepEqual(keys(snapshot), [
    "checked_at",
    "customer_health",
    "lead_funnel",
    "leads",
    "needs_attention",
    "queue",
    "recent_audit",
    "recent_events",
    "runtime",
    "search_index",
    "sla",
    "traffic",
    "traffic_by_hour",
  ]);
  assert.deepEqual(keys(snapshot.properties.traffic), [
    "active_tenants_15m",
    "checkout_15m",
    "events_24h",
    "return_15m",
  ]);
  assert.deepEqual(keys(snapshot.properties.queue), ["completed", "failed", "processing", "queued"]);
  assert.deepEqual(keys(snapshot.properties.sla), [
    "error_rate_percent",
    "median_latency_ms",
    "p95_latency_ms",
    "probe_latency_ms",
  ]);
  assert.deepEqual(keys(snapshot.properties.recent_events.items), [
    "action_time",
    "action_type",
    "gear_barcode",
    "gear_name",
    "student_id",
    "student_username",
    "tenant_id",
    "tenant_name",
  ]);
});

test("generated support request contracts preserve the privacy category", async () => {
  const contracts = JSON.parse(
    await readFile(new URL("../docs/api/generated/edge-contracts.schema.json", import.meta.url), "utf8"),
  );
  const contactCategories = contracts.schemas.contactSupportSubmitRequest
    .properties.category.enum;
  const supportCategories = contracts.schemas.superOpsResponses.properties
    .list_support_requests.properties.data.properties.requests.items
    .properties.category.enum;

  assert.ok(contactCategories.includes("privacy"));
  assert.ok(supportCategories.includes("privacy"));
});
