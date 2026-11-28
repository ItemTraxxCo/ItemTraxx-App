import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("does not advertise unused Vite function overrides", () => {
  assert.doesNotMatch(envExample, /^\s*#?\s*VITE_TENANT_LOGIN_FUNCTION=/m);
  assert.doesNotMatch(envExample, /^\s*#?\s*VITE_LOGIN_NOTIFY_FUNCTION=/m);
});
