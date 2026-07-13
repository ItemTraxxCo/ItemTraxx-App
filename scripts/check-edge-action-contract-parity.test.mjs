import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertActionParity,
  inspectEdgeActionContractParity,
  readRegistryActions,
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

test("runtime registries have exact generated request and response coverage", async () => {
  assert.deepEqual(await inspectEdgeActionContractParity(), [
    { endpoint: "admin-ops", count: 11 },
    { endpoint: "super-ops", count: 26 },
  ]);
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
