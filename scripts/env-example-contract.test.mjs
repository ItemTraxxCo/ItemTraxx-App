import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("does not advertise the unused tenant login function override", () => {
  assert.doesNotMatch(envExample, /^#\s*VITE_TENANT_LOGIN_FUNCTION=/m);
});

test("retains configuration examples that have runtime consumers", () => {
  assert.match(envExample, /^# VITE_STATUS_FUNCTION=system-status$/m);
  assert.match(envExample, /^# ITX_ENVIRONMENT=development$/m);
  assert.match(envExample, /^# ITX_LOGIN_NOTIFY_ENABLED=true$/m);
  assert.match(envExample, /^# ITX_CLIENT_ERROR_SLACK_WEBHOOK_URL=$/m);
});
