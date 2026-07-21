import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  formatLoginEmailLocation,
  formatLoginEmailPlatform,
  formatLoginEmailTime,
} from "./loginEmailFormat.ts";

Deno.test("login email fields are concise and Pacific-localized", () => {
  assertEquals(formatLoginEmailTime("2026-05-02T23:45:00.000Z"), "May 2, 2026, 4:45 PM PDT");
  assertEquals(
    formatLoginEmailPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"),
    "Chrome on Mac",
  );
  assertEquals(formatLoginEmailLocation("SAN Jose, California"), "San Jose, California");
});
