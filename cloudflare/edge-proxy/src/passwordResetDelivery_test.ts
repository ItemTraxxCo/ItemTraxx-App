import {
  getPasswordResetDelivery,
  sendPasswordResetEmail,
} from "./passwordResetDelivery.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const user = { email: "tenant@example.com", name: "Tenant User" };
const url = "https://edge.itemtraxx.com/api/auth/reset-password/token";

Deno.test("password reset delivery records a successful Resend response", async () => {
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;
  try {
    globalThis.fetch = async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ id: "re_test_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const deliveryRequest = new Request("https://edge.itemtraxx.com/api/auth/request-password-reset", {
      method: "POST",
    });
    await sendPasswordResetEmail({
      env: { RESEND_API_KEY: "test-key", ITX_RESEND_FROM: "notifications@itemtraxx.com" },
      user,
      url,
      request: deliveryRequest,
    });

    const providerRequest = request;
    assert(providerRequest, "Resend was not called");
    assert(providerRequest.headers.get("authorization") === "Bearer test-key", "missing Resend authorization");
    const payload = await providerRequest.json() as Record<string, unknown>;
    assert(payload.from === "notifications@itemtraxx.com", "incorrect sender");
    assert(payload.to instanceof Array && payload.to[0] === user.email, "incorrect recipient");
    assert(typeof payload.html === "string" && payload.html.includes("Reset your ItemTraxx password"), "missing branded HTML");
    const resetLine = typeof payload.text === "string"
      ? payload.text.split("\n").find((line) => line.startsWith("Reset your password:"))
      : null;
    assert(resetLine === `Reset your password: ${url}`, "missing text fallback");
    const outcome = getPasswordResetDelivery(deliveryRequest);
    assert(outcome?.status === "sent", "successful delivery was not recorded");
    assert(outcome.providerMessageId === "re_test_123", "provider message ID was not recorded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("password reset delivery fails closed when configuration is incomplete", async () => {
  const deliveryRequest = new Request("https://edge.itemtraxx.com/api/auth/request-password-reset", {
    method: "POST",
  });
  let failed = false;
  try {
    await sendPasswordResetEmail({
      env: { RESEND_API_KEY: "test-key" },
      user,
      url,
      request: deliveryRequest,
    });
  } catch (cause) {
    failed = true;
    assert(cause instanceof Error && cause.message.includes("not configured"), "unexpected configuration error");
  }
  assert(failed, "missing sender configuration did not fail");
  assert(getPasswordResetDelivery(deliveryRequest)?.status === "failed", "configuration failure was not recorded");
});

Deno.test("password reset delivery records provider rejection without leaking secrets", async () => {
  const originalFetch = globalThis.fetch;
  const deliveryRequest = new Request("https://edge.itemtraxx.com/api/auth/request-password-reset", {
    method: "POST",
  });
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "invalid from" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    let failed = false;
    try {
      await sendPasswordResetEmail({
        env: { RESEND_API_KEY: "secret-key", ITX_RESEND_FROM: "bad" },
        user,
        url,
        request: deliveryRequest,
      });
    } catch (cause) {
      failed = true;
      assert(cause instanceof Error && cause.message === "Password reset email delivery failed (422)", "unexpected provider error");
      assert(!cause.message.includes("secret-key"), "provider error leaked a secret");
    }
    assert(failed, "provider rejection did not fail");
    const outcome = getPasswordResetDelivery(deliveryRequest);
    assert(outcome?.status === "failed", "provider rejection was not recorded");
    assert(!outcome.message.includes("secret-key"), "recorded failure leaked a secret");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("password reset delivery records network failures", async () => {
  const originalFetch = globalThis.fetch;
  const deliveryRequest = new Request("https://edge.itemtraxx.com/api/auth/request-password-reset", {
    method: "POST",
  });
  try {
    globalThis.fetch = async () => {
      throw new Error("network unavailable");
    };
    let failed = false;
    try {
      await sendPasswordResetEmail({
        env: { RESEND_API_KEY: "test-key", ITX_RESEND_FROM: "notifications@itemtraxx.com" },
        user,
        url,
        request: deliveryRequest,
      });
    } catch {
      failed = true;
    }
    assert(failed, "network failure did not fail");
    assert(getPasswordResetDelivery(deliveryRequest)?.status === "failed", "network failure was not recorded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
