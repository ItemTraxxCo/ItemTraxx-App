import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { resolveSystemStatusOverride } from "./systemStatusOverride.ts";

Deno.test("resolveSystemStatusOverride maps supported manual modes", () => {
  assertEquals(resolveSystemStatusOverride({ mode: "running" }), {
    status: "operational",
    summary: "manual status override: running",
  });
  assertEquals(resolveSystemStatusOverride({ mode: "degraded" }), {
    status: "degraded",
    summary: "manual status override: degraded",
  });
  assertEquals(resolveSystemStatusOverride({ mode: "outage" }), {
    status: "down",
    summary: "manual status override: outage",
  });
});

Deno.test("resolveSystemStatusOverride leaves auto and invalid values to health checks", () => {
  assertEquals(resolveSystemStatusOverride({ mode: "auto" }), null);
  assertEquals(resolveSystemStatusOverride({ mode: "unexpected" }), null);
  assertEquals(resolveSystemStatusOverride(null), null);
});
