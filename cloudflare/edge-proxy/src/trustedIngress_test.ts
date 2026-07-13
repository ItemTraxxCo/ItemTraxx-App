import {
  applyTrustedIngressHeaders,
  hashTrustedIngressBody,
  signTrustedIngress,
} from "./trustedIngress.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
};

Deno.test("trusted-ingress hashing and signing preserve fixed byte-level fixtures", async () => {
  const body = new TextEncoder().encode('{"amount":"café"}');
  const bodyHash = await hashTrustedIngressBody(body);
  assertEquals(
    bodyHash,
    "60f760a777617df09478ebf025b5cddc22c387ed8599c420042374296e6cdc2c",
    "UTF-8 body hash",
  );
  assertEquals(await hashTrustedIngressBody(null), "no-body", "null body marker");

  const message = `1712345678901.request-123.POST.checkoutReturn.${bodyHash}`;
  assertEquals(
    await signTrustedIngress("fixture-secret", message),
    "441f86e3a8877e9abd4e742b6b9ab375bd40766e3a4c990ca102310a04a7fbfe",
    "HMAC fixture",
  );
});

Deno.test("trusted-ingress headers sign the exact timestamp, request, method, target, and body bytes", async () => {
  const originalNow = Date.now;
  Date.now = () => 1712345678901;
  try {
    const headers = new Headers();
    const body = new TextEncoder().encode('{"amount":"café"}');
    await applyTrustedIngressHeaders(
      headers,
      { ITX_EDGE_PROXY_SHARED_SECRET: " fixture-secret " } as Env,
      "request-123",
      "checkoutReturn",
      "post",
      body,
    );

    assertEquals(headers.get("x-itx-edge-proxy"), "1", "trusted marker");
    assertEquals(headers.get("x-itx-edge-proxy-ts"), "1712345678901", "timestamp header");
    assertEquals(
      headers.get("x-itx-edge-proxy-signature"),
      "441f86e3a8877e9abd4e742b6b9ab375bd40766e3a4c990ca102310a04a7fbfe",
      "signature header",
    );
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("trusted-ingress headers remain absent without a nonblank secret", async () => {
  for (const secret of [undefined, "", "   "]) {
    const headers = new Headers({ existing: "kept" });
    await applyTrustedIngressHeaders(
      headers,
      { ITX_EDGE_PROXY_SHARED_SECRET: secret } as Env,
      "request-123",
      "system-status",
      "GET",
      null,
    );
    assertEquals(headers.get("existing"), "kept", "existing header");
    assertEquals(headers.get("x-itx-edge-proxy"), null, "trusted marker");
    assertEquals(headers.get("x-itx-edge-proxy-ts"), null, "timestamp header");
    assertEquals(headers.get("x-itx-edge-proxy-signature"), null, "signature header");
  }
});
