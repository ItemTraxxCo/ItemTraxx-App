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
    "https://app.itemtraxx.com,https://testdist.app.itemtraxx.com",
  );

  assert(isAllowedOrigin("https://app.itemtraxx.com", allowedOrigins));
  assert(isAllowedOrigin("https://testdist.app.itemtraxx.com", allowedOrigins));
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
