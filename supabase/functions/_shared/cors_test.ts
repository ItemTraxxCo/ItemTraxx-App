import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "./cors.ts";

Deno.test("parseAllowedOrigins trims blank entries", () => {
  assertEquals(
    parseAllowedOrigins(" https://app.itemtraxx.com, ,https://itemtraxx.com "),
    ["https://app.itemtraxx.com", "https://itemtraxx.com"],
  );
});

Deno.test("isAllowedOrigin requires exact configured origins", () => {
  const allowedOrigins = parseAllowedOrigins(
    "https://app.itemtraxx.com,https://staging.itemtraxx.com",
  );

  assert(isAllowedOrigin("https://app.itemtraxx.com", allowedOrigins));
  assert(isAllowedOrigin("https://staging.itemtraxx.com", allowedOrigins));
  const demoOrigin = parseAllowedOrigins("https://itxdemo.app.itemtraxx.com");
  assert(isAllowedOrigin("https://itxdemo.app.itemtraxx.com", demoOrigin));
});

Deno.test("isAllowedOrigin does not expand wildcard origin patterns", () => {
  const allowedOrigins = parseAllowedOrigins("https://*.itemtraxx.com");

  assert(!isAllowedOrigin("https://app.itemtraxx.com", allowedOrigins));
  assert(
    !isAllowedOrigin("https://itemtraxx.com.attacker.com", allowedOrigins),
  );
  assert(
    !isAllowedOrigin("https://evil.itemtraxx.com.attacker.com", allowedOrigins),
  );
});

Deno.test("isAllowedOrigin requires provider-managed workspace app origins", () => {
  const workspaceOrigin = "https://new-workspace.app.itemtraxx.com";
  assert(!isAllowedOrigin(workspaceOrigin, []));
  assert(isAllowedOrigin(workspaceOrigin, [workspaceOrigin]));
  assert(!isAllowedOrigin("http://new-workspace.app.itemtraxx.com", []));
  assert(!isAllowedOrigin("https://app.app.itemtraxx.com", []));
  assert(!isAllowedOrigin("https://two.levels.app.itemtraxx.com", []));
  assert(!isAllowedOrigin("https://workspace.app.itemtraxx.com.attacker.com", []));
  for (const reserved of ["itxdemo", "pentest", "pentest2", "testdist"]) {
    assert(!isAllowedOrigin(`https://${reserved}.app.itemtraxx.com`, []));
  }
});
