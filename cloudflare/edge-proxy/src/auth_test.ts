import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeBetterAuthCaptchaRequest } from "./authCaptcha.ts";
import { sanitizeSsoProvider } from "./auth.ts";

Deno.test("promotes a form captcha field to Better Auth's header", async () => {
  const request = new Request("https://edge.itemtraxx.com/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=user%40example.com&password=correct-horse&captchaResponse=turnstile-token",
  });

  const normalized = await normalizeBetterAuthCaptchaRequest(request);

  assertNotEquals(normalized, request);
  assertEquals(normalized.headers.get("x-captcha-response"), "turnstile-token");
  assertEquals(
    normalized.headers.get("content-type"),
    "application/x-www-form-urlencoded;charset=UTF-8",
  );
  assertEquals(await normalized.text(), "email=user%40example.com&password=correct-horse");
});

Deno.test("leaves requests without a form captcha unchanged", async () => {
  const request = new Request("https://edge.itemtraxx.com/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=user%40example.com&password=correct-horse",
  });

  const normalized = await normalizeBetterAuthCaptchaRequest(request);

  assertEquals(normalized, request);
  assertEquals(await normalized.text(), "email=user%40example.com&password=correct-horse");
});

Deno.test("sanitizes SSO provider configuration before returning it to the browser", () => {
  const sanitized = sanitizeSsoProvider({
    providerId: "acme",
    issuer: "https://idp.example.test",
    domain: "example.test",
    domainVerified: false,
    organizationId: "org-1",
    oidcConfig: JSON.stringify({ clientId: "public-id", clientSecret: "private-secret" }),
    samlConfig: JSON.stringify({ cert: "private-cert", privateKey: "private-key" }),
  });

  assertEquals(sanitized.oidcConfig, {});
  assertEquals(sanitized.samlConfig, {});
  assertEquals("private-secret" in sanitized, false);
  assertEquals("private-key" in sanitized, false);
});
