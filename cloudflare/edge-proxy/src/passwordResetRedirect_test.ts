import {
  CANONICAL_PASSWORD_RESET_URL,
  normalizeBetterAuthPasswordResetRequest,
  resolvePasswordResetRedirect,
} from "./passwordResetRedirect.ts";
import {
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const productionEnv = { BETTER_AUTH_URL: "https://edge.itemtraxx.com" };

Deno.test("password reset redirects default to the public canonical page", () => {
  assertEquals(
    resolvePasswordResetRedirect(productionEnv, undefined),
    CANONICAL_PASSWORD_RESET_URL,
  );
  assertEquals(
    resolvePasswordResetRedirect(
      productionEnv,
      "https://itemtraxx.com/reset-password",
    ),
    CANONICAL_PASSWORD_RESET_URL,
  );
});

Deno.test("password reset redirects normalize Access hosts and preserve staging", () => {
  assertEquals(
    resolvePasswordResetRedirect(
      productionEnv,
      "https://itxinternal.app.itemtraxx.com/reset-password",
    ),
    CANONICAL_PASSWORD_RESET_URL,
  );
  assertEquals(
    resolvePasswordResetRedirect(
      productionEnv,
      "https://internal.itemtraxx.com/reset-password",
    ),
    CANONICAL_PASSWORD_RESET_URL,
  );
  assertEquals(
    resolvePasswordResetRedirect(
      productionEnv,
      "https://preview.itemtraxx.com/reset-password",
    ),
    "https://preview.itemtraxx.com/reset-password",
  );
  assertThrows(
    () =>
      resolvePasswordResetRedirect(
        productionEnv,
        "https://attacker.example/reset-password",
      ),
    Error,
    "Invalid password reset redirect",
  );
  assertThrows(
    () =>
      resolvePasswordResetRedirect(
        productionEnv,
        "http://localhost:5173/reset-password",
      ),
    Error,
    "Invalid password reset redirect",
  );
});

Deno.test("local development keeps a localhost password reset page", () => {
  assertEquals(
    resolvePasswordResetRedirect(
      { BETTER_AUTH_URL: "http://localhost:8787" },
      undefined,
    ),
    "http://localhost:8787/reset-password",
  );
  assertEquals(
    resolvePasswordResetRedirect(
      { BETTER_AUTH_URL: "http://localhost:8787" },
      "http://127.0.0.1:5173/reset-password",
    ),
    "http://127.0.0.1:5173/reset-password",
  );
});

Deno.test("public reset requests preserve the local app origin in development", async () => {
  const request = new Request(
    "http://localhost:8787/api/auth/request-password-reset",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user@example.com",
        redirectTo: "http://localhost:5173/reset-password",
      }),
    },
  );

  const normalized = await normalizeBetterAuthPasswordResetRequest(request, {
    BETTER_AUTH_URL: "http://localhost:8787",
  });

  if (normalized instanceof Response) throw new Error("Expected a request");
  assertEquals(
    (await normalized.json()).redirectTo,
    "http://localhost:5173/reset-password",
  );
});

Deno.test("public reset requests replace caller callback URLs in JSON", async () => {
  const request = new Request(
    "https://edge.itemtraxx.com/api/auth/request-password-reset",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user@example.com",
        redirectTo: "https://itxinternal.app.itemtraxx.com/reset-password",
      }),
    },
  );

  const normalized = await normalizeBetterAuthPasswordResetRequest(
    request,
    productionEnv,
  );

  if (normalized instanceof Response) throw new Error("Expected a request");
  assertEquals(await normalized.json(), {
    email: "user@example.com",
    redirectTo: CANONICAL_PASSWORD_RESET_URL,
  });
});

Deno.test("public reset requests preserve form fields while replacing callback URLs", async () => {
  const request = new Request(
    "https://edge.itemtraxx.com/api/auth/request-password-reset",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "user@example.com",
        redirectTo: "https://itxinternal.app.itemtraxx.com/reset-password",
        captchaResponse: "captcha-token",
      }),
    },
  );

  const normalized = await normalizeBetterAuthPasswordResetRequest(
    request,
    productionEnv,
  );

  if (normalized instanceof Response) throw new Error("Expected a request");
  assertEquals(
    await normalized.formData().then((form) => Object.fromEntries(form)),
    {
      email: "user@example.com",
      redirectTo: CANONICAL_PASSWORD_RESET_URL,
      captchaResponse: "captcha-token",
    },
  );
});

Deno.test("reset token callbacks always redirect to the canonical page", async () => {
  const request = new Request(
    "https://edge.itemtraxx.com/api/auth/reset-password/one-time-token?callbackURL=https%3A%2F%2Fitxinternal.app.itemtraxx.com%2Freset-password",
  );

  const normalized = await normalizeBetterAuthPasswordResetRequest(
    request,
    productionEnv,
  );

  if (normalized instanceof Response) throw new Error("Expected a request");
  assertEquals(
    new URL(normalized.url).searchParams.get("callbackURL"),
    CANONICAL_PASSWORD_RESET_URL,
  );
});

Deno.test("local reset callbacks preserve the local app origin", async () => {
  const request = new Request(
    "http://localhost:8787/api/auth/reset-password/one-time-token?callbackURL=http%3A%2F%2Flocalhost%3A5173%2Freset-password",
  );

  const normalized = await normalizeBetterAuthPasswordResetRequest(request, {
    BETTER_AUTH_URL: "http://localhost:8787",
  });

  if (normalized instanceof Response) throw new Error("Expected a request");
  assertEquals(
    new URL(normalized.url).searchParams.get("callbackURL"),
    "http://localhost:5173/reset-password",
  );
});

Deno.test("unrelated Better Auth requests are unchanged", async () => {
  const request = new Request(
    "https://edge.itemtraxx.com/api/auth/get-session",
  );
  const normalized = await normalizeBetterAuthPasswordResetRequest(
    request,
    productionEnv,
  );
  assertStrictEquals(normalized, request);
});

Deno.test("public reset requests reject unsupported content types", async () => {
  const request = new Request(
    "https://edge.itemtraxx.com/api/auth/request-password-reset",
    {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "email=user@example.com",
    },
  );

  const result = await normalizeBetterAuthPasswordResetRequest(
    request,
    productionEnv,
  );

  if (!(result instanceof Response)) throw new Error("Expected a response");
  assertEquals(result.status, 415);
});
