import { assertEquals, assertMatch } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { createIntercomJwt, INTERCOM_JWT_TTL_SECONDS } from "./intercomJwt.ts";

const decodePart = (part: string) =>
  JSON.parse(atob(part.replaceAll("-", "+").replaceAll("_", "/"))) as Record<string, unknown>;

Deno.test("createIntercomJwt signs the stable user ID and email with an expiry", async () => {
  const token = await createIntercomJwt(
    { id: "user-123", email: "person@example.com" },
    "intercom-test-secret",
    1_700_000_000,
  );
  const parts = token.split(".");

  assertEquals(parts.length, 3);
  assertEquals(decodePart(parts[0]), { alg: "HS256", typ: "JWT" });
  assertEquals(decodePart(parts[1]), {
    user_id: "user-123",
    email: "person@example.com",
    iat: 1_700_000_000,
    exp: 1_700_000_000 + INTERCOM_JWT_TTL_SECONDS,
  });
  assertMatch(parts[2], /^[A-Za-z0-9_-]+$/u);
});

Deno.test("createIntercomJwt omits a blank email but still requires the ID", async () => {
  const token = await createIntercomJwt({ id: "  user-123  ", email: "   " }, "secret", 10);
  const payload = decodePart(token.split(".")[1]);
  assertEquals(payload.user_id, "user-123");
  assertEquals("email" in payload, false);
});
