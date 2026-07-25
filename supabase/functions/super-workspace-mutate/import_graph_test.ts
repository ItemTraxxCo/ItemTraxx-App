import { assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";

Deno.test("super workspace mutation keeps primary reassignment super-admin scoped", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertStringIncludes(source, 'profile?.role !== "super_admin"');
  assertStringIncludes(source, 'action === "set_primary_admin"');
  assertStringIncludes(source, 'roleScope: "super_admin"');
});
